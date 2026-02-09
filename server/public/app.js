(function () {
const API = '';
    const PAGE = (document.body && document.body.getAttribute('data-page')) || '';

    // ── Page progress bar (Tabler turbo-style) ──
    var _progressEl = null;
    var _progressBarEl = null;
    var _progressActive = 0;
    var _progressHideTimer = null;
    function _ensureProgress() {
      if (_progressEl) return;
      _progressEl = document.createElement('div');
      _progressEl.className = 'page-progress';
      _progressEl.innerHTML = '<div class="page-progress-bar"></div>';
      document.body.prepend(_progressEl);
      _progressBarEl = _progressEl.querySelector('.page-progress-bar');
    }
    function showPageProgress() {
      _ensureProgress();
      _progressActive++;
      if (_progressHideTimer) { clearTimeout(_progressHideTimer); _progressHideTimer = null; }
      _progressBarEl.style.transition = 'none';
      _progressBarEl.style.width = '0%';
      _progressEl.classList.add('active');
      requestAnimationFrame(function() {
        _progressBarEl.style.transition = 'width 8s cubic-bezier(0.1, 0.05, 0, 1)';
        _progressBarEl.style.width = '85%';
      });
    }
    function hidePageProgress() {
      _ensureProgress();
      _progressActive = Math.max(0, _progressActive - 1);
      if (_progressActive > 0) return;
      _progressBarEl.style.transition = 'width 0.2s ease';
      _progressBarEl.style.width = '100%';
      _progressHideTimer = setTimeout(function() {
        _progressEl.classList.remove('active');
        _progressBarEl.style.width = '0%';
        _progressHideTimer = null;
      }, 300);
    }
    const LIVE_REFRESH_MS = 60000;
    const RANGE_REFRESH_MS = 5 * 60 * 1000; // Today and Sales refresh every 5 min
    const ACTIVE_WINDOW_MS = 10 * 60 * 1000; // Live view: only show sessions seen in last 10 min
    const ARRIVED_WINDOW_MS = 60 * 60 * 1000; // Live view: only show sessions that arrived in last 60 min
    const STATS_REFRESH_MS = 5 * 60 * 1000; // Breakdown / Products / Traffic refresh (Today only)
    const SALE_MUTED_KEY = 'livevisitors-sale-muted';
    const TOP_TABLE_PAGE_SIZE = 10;
    const COUNTRY_PAGE_SIZE = 25;
    const COUNTRY_PRODUCTS_PAGE_SIZE = 25;
    const BREAKDOWN_PAGE_SIZE = 25;
    const ROWS_PER_PAGE_DEFAULT = 25;
    function loadRowsPerPage() {
      return ROWS_PER_PAGE_DEFAULT;
    }
    let rowsPerPage = loadRowsPerPage();
    let sessions = [];
    let sessionsLoadError = null;
    let statsCache = {};
    let trafficCache = null;
    let trafficTypeExpanded = null; // device -> boolean (Traffic Type tree) — null = first render, default all open
    let dateRange = PAGE === 'sales' ? 'sales' : PAGE === 'date' ? 'today' : PAGE === 'dashboard' ? 'today' : 'live';
    let customRangeStartYmd = null; // YYYY-MM-DD (admin TZ)
    let customRangeEndYmd = null; // YYYY-MM-DD (admin TZ)
    let pendingCustomRangeStartYmd = null; // modal-only pending selection
    let pendingCustomRangeEndYmd = null; // modal-only pending selection
    let customCalendarLastPayload = null; // last /api/available-days payload used for rendering
    /** When dateRange is 'live' or 'sales', stats/KPIs use today's data; only the main table shows those special views. */
    function normalizeRangeKeyForApi(key) {
      const k = (key == null ? '' : String(key)).trim().toLowerCase();
      // UI uses friendly labels (7days/14days/30days) but APIs + server payload keys use 7d/14d/30d.
      if (k === '7days') return '7d';
      if (k === '14days') return '14d';
      if (k === '30days') return '30d';
      return k;
    }
    function getStatsRange() {
      const raw = (dateRange === 'live' || dateRange === 'sales' || dateRange === '1h') ? 'today' : dateRange;
      return normalizeRangeKeyForApi(raw);
    }

    // Shopify embedded app: keep the signed query params on internal navigation.
    // Without this, moving from `/?shop=...&hmac=...` to `/dashboard` drops the signature and API calls can 401.
    (function propagateShopifySignedQueryToLinks() {
      try {
        const cur = new URL(window.location.href);
        const sp = cur.searchParams;
        const shop = sp.get('shop');
        const hmac = sp.get('hmac');
        const ts = sp.get('timestamp');
        if (!shop || !hmac || !ts) return;
        if (!/\.myshopify\.com$/i.test(shop)) return;

        const signedEntries = [];
        sp.forEach(function(v, k) { signedEntries.push([k, v]); });
        const signedKeys = new Set(signedEntries.map(function(e) { return e[0]; }));

        const isAssetPath = function(p) {
          if (!p) return false;
          if (p.startsWith('/assets/')) return true;
          return /\.(css|js|png|webp|jpg|jpeg|gif|svg|ico|map|txt)$/i.test(p);
        };

        document.querySelectorAll('a[href]').forEach(function(a) {
          const rawHref = a.getAttribute('href');
          if (!rawHref) return;
          const h = rawHref.trim();
          if (!h || h[0] === '#') return;
          if (/^(javascript:|mailto:|tel:)/i.test(h)) return;

          let u;
          try { u = new URL(h, cur.origin); } catch (_) { return; }
          if (u.origin !== cur.origin) return;
          if ((u.pathname || '').startsWith('/api/')) return;
          if (isAssetPath(u.pathname || '')) return;

          // Don't add signed params to links that already have extra params:
          // adding any new key would invalidate the existing hmac.
          let hasNonSigned = false;
          u.searchParams.forEach(function(_v, k) { if (!signedKeys.has(k)) hasNonSigned = true; });
          if (hasNonSigned) return;

          signedEntries.forEach(function(pair) {
            u.searchParams.set(pair[0], pair[1]);
          });
          a.setAttribute('href', u.pathname + '?' + u.searchParams.toString() + (u.hash || ''));
        });
      } catch (_) {}
    })();

    function getKpiData() {
      if (kpiCache) return kpiCache;
      if (getStatsRange() === 'today') return {};
      return statsCache || {};
    }
    let activeMainTab = 'spy';
    let nextLiveAt = 0;
    let nextRangeAt = 0; // next refresh for Today/Sales (5 min)
    let lastSessionsFetchedAt = 0;
    let lastSessionsMode = null; // 'live' or 'range' - helps avoid Online count flicker when switching modes
    let lastStatsFetchedAt = 0;
    let lastKpisFetchedAt = 0;
    let lastTrafficFetchedAt = 0;
    let lastProductsFetchedAt = 0;
    let kpiCache = null;
    let liveRefreshInFlight = null;
    let statsRefreshInFlight = null;
    let trafficRefreshInFlight = null;
    let productsRefreshInFlight = null;
    let kpisRefreshInFlight = null;
    let configStatusRefreshInFlight = null;
    let activeKpiCompareKey = 'conv';
    let reportBuildTokens = { stats: 0, breakdown: 0, products: 0, traffic: 0 };
    var _intervals = [];
    var _eventSource = null;
    var _fetchAbortControllers = {};
    let lastUpdateTime = null;
    let lastConvertedCountToday = 0;
    let hasSeenConvertedCountToday = false; // prevents "sale" triggers on first load
    let convertedCountDayYmd = null; // YYYY-MM-DD in admin TZ; resets converted-count baseline daily
    let lastSaleAt = null; // ms; authoritative timestamp of most recent sale we know about (Shopify truth preferred)
    let lastOnlineCount = null; // when dateRange !== 'live', we fetch active count so Online always shows real people online
    let onlineCountInFlight = false;
    let shopifySalesToday = null;
    let shopifyOrderCountToday = null;
    let shopifySalesTodayLoaded = false; // true once we have attempted to fetch (success or failure)
    let shopifySalesTodayLoading = false;
    let shopifySessionsToday = null;
    let shopifySessionsTodayLoaded = false;
    let shopifySessionsTodayLoading = false;
    const PRODUCTS_LEADERBOARD_VIEW_KEY = 'products-leaderboard-view';
    const PRODUCTS_LEADERBOARD_FETCH_LIMIT = 20;
    let productsLeaderboardView = 'title';
    let leaderboardCache = null;
    let leaderboardLoading = false;
    const PRODUCTS_VARIANT_CARDS_VIEW_KEY = 'products-variant-cards-view';
    let productsVariantCardsView = 'finishes';
    let finishesCache = null;
    let finishesLoading = false;
    let lengthsCache = null;
    let lengthsLoading = false;
    let chainStylesCache = null;
    let chainStylesLoading = false;
    let bestSellersCache = null;
    let bestVariantsCache = null;
    let countryPage = 1;
    let lastCountryRowCount = 0;
    let bestGeoProductsPage = 1;
    let bestSellersPage = 1;
    let bestVariantsPage = 1;
    let bestSellersSortBy = 'rev';
    let bestSellersSortDir = 'desc';
    const tableSortState = {
      country: { by: 'rev', dir: 'desc' },
      bestGeoProducts: { by: 'rev', dir: 'desc' },
      aov: { by: 'aov', dir: 'desc' },
      bestVariants: { by: 'rev', dir: 'desc' },
      trafficSources: { by: 'rev', dir: 'desc' },
      trafficTypes: { by: 'rev', dir: 'desc' },
    };
    const TABLE_SORT_DEFAULTS = {
      country: { country: 'asc', cr: 'desc', sales: 'desc', clicks: 'desc', rev: 'desc' },
      bestGeoProducts: { country: 'asc', cr: 'desc', sales: 'desc', clicks: 'desc', rev: 'desc' },
      aov: { aov: 'desc' },
      bestVariants: { variant: 'asc', sales: 'desc', clicks: 'desc', rev: 'desc', cr: 'desc' },
      trafficSources: { source: 'asc', cr: 'desc', orders: 'desc', sessions: 'desc', rev: 'desc' },
      trafficTypes: { type: 'asc', cr: 'desc', orders: 'desc', sessions: 'desc', rev: 'desc' },
    };
    let saleAudio = null;
    let saleMuted = false;
    let saleAudioPrimed = false;
    let saleSoundDeferredOnce = false;
    let saleToastActive = false;
    let saleToastToken = 0; // increments per toast trigger; prevents stale latest-sale fetch overwriting newer toasts
    let saleToastSessionId = null; // best-effort: session_id that opened the current toast (used to avoid double plays)
    let saleToastHideTimer = null;
    let saleToastLastOrderId = null;
    let saleToastLastPayload = null;
    let saleToastPinned = false;
    let saleToastLastShownAt = 0;
    let currentPage = 1;
    let sortBy = 'last_seen';
    let sortDir = 'desc';
    const SORT_DEFAULTS = { landing: 'asc', from: 'asc', arrived: 'desc', source: 'asc', device: 'asc', cart: 'desc', last_seen: 'desc', history: 'desc' };

    (function restoreProductsVariantCardsView() {
      try {
        const raw = sessionStorage.getItem(PRODUCTS_VARIANT_CARDS_VIEW_KEY);
        const s = raw != null ? String(raw).trim().toLowerCase() : '';
        productsVariantCardsView = (s === 'lengths' || s === 'length') ? 'lengths' : 'finishes';
      } catch (_) {
        productsVariantCardsView = 'finishes';
      }
    })();

    (function restoreProductsLeaderboardView() {
      try {
        const raw = sessionStorage.getItem(PRODUCTS_LEADERBOARD_VIEW_KEY);
        const s = raw != null ? String(raw).trim().toLowerCase() : '';
        productsLeaderboardView = (s === 'type') ? 'type' : 'title';
      } catch (_) {
        productsLeaderboardView = 'title';
      }
    })();

    // Auto-configure pixel when opened from Shopify (shop in URL) so merchants don't run mutations manually
    (function ensurePixelOnce() {
      const params = new URLSearchParams(window.location.search);
      const shop = params.get('shop');
      if (shop && /\.myshopify\.com$/i.test(shop)) {
        fetch(API + '/api/pixel/ensure?shop=' + encodeURIComponent(shop), { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.ok && data.action) console.log('[Live Visitors] Pixel', data.action);
          })
          .catch(function () {});
      }
    })();
    // 'active' = Live view (last 5 min + arrived 60 min). Range mode uses ?range= with pagination.
    let filter = 'active';
    let sessionsTotal = null; // set when fetching by range (today/yesterday/3d/7d); null for Live
    let selectedSessionId = null;
    let timeTick = null;
    const tz = 'Europe/London';
    const MIN_YMD = '2025-02-01';

    function floorAllowsYesterday() {
      try {
        return ymdNowInTz() > MIN_YMD;
      } catch (_) {
        return true;
      }
    }

    function updateServerTimeDisplay() {
      const el = document.getElementById('server-time-msg');
      if (!el) return;
      var now = new Date();
      el.textContent = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function updateNextUpdateUi() {
      const block = document.querySelector('#tab-panel-spy .next-update-block');
      if (!block) return;
      const labelEl = document.getElementById('next-update-label');
      const timerWrap = document.getElementById('next-update-timer-wrap');
      const isLive = dateRange === 'live';
      const show = activeMainTab === 'spy' && (isLive || dateRange === 'sales' || dateRange === 'today' || dateRange === '1h');
      block.classList.toggle('is-hidden', !show);
      if (!show) return;

      if (labelEl) labelEl.classList.toggle('is-hidden', isLive);
      if (timerWrap) timerWrap.classList.toggle('is-hidden', isLive);
      if (isLive) {
        if (timerWrap) timerWrap.style.setProperty('--progress', '0');
        return;
      }
      if (!timerWrap) return;

      const duration = RANGE_REFRESH_MS;
      const target = (typeof nextRangeAt === 'number' && nextRangeAt > Date.now())
        ? nextRangeAt
        : (Date.now() + RANGE_REFRESH_MS);
      const remaining = Math.max(0, target - Date.now());
      const progress = Math.min(1, 1 - remaining / duration);
      timerWrap.style.setProperty('--progress', String(progress));
    }

    function toMs(v) {
      if (v == null || v === '') return null;
      let n = typeof v === 'number' ? v : Number(v);
      if (Number.isNaN(n)) return null;
      if (n < 1e12) n *= 1000;
      return n;
    }

    function formatTs(ms) {
      const n = toMs(ms);
      if (n == null) return '\u2014';
      const d = new Date(n);
      if (Number.isNaN(d.getTime())) return '\u2014';
      return d.toLocaleString('en-GB', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });
    }

    function formatRelative(ms) {
      const n = toMs(ms);
      if (n == null) return '';
      const s = Math.floor((Date.now() - n) / 1000);
      if (s < 60) return s + 's ago';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      return Math.floor(s / 3600) + 'h ago';
    }

    function formatSaleTime(ms) {
      const n = toMs(ms);
      if (n == null) return '\u2014';
      const d = new Date(n);
      if (Number.isNaN(d.getTime())) return '\u2014';
      try {
        return d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
      } catch (_) {
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
    }

    function ymdNowInTz() {
      try {
        // en-CA yields YYYY-MM-DD.
        return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      } catch (_) {
        return new Date().toISOString().slice(0, 10);
      }
    }

    function updateLastSaleAgo() {
      var els = document.querySelectorAll('.last-sale-ago');
      if (!els.length) return;
      var text = lastSaleAt == null ? '\u2014' : formatRelative(lastSaleAt);
      els.forEach(function(el) { el.textContent = text; });
    }

    function setLastSaleAt(ms) {
      const n = toMs(ms);
      if (n == null) return;
      const cur = lastSaleAt == null ? null : toMs(lastSaleAt);
      if (cur == null || n > cur) {
        lastSaleAt = n;
        updateLastSaleAgo();
      }
    }

    function formatDuration(startMs) {
      const n = toMs(startMs);
      if (n == null) return '';
      const s = Math.floor((Date.now() - n) / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      if (h > 0) return h + 'h ' + (m % 60) + 'm';
      if (m > 0) return m + 'm ' + (s % 60) + 's';
      return s + 's';
    }

    var countryNames = { GB: 'UK', US: 'USA', CA: 'CA', AU: 'AU', DE: 'DE', FR: 'FR', IE: 'IE', ES: 'ES', IT: 'IT', NL: 'NL', IN: 'IN', JP: 'JP', DK: 'DK', SE: 'SE', NO: 'NO', TH: 'TH', NZ: 'NZ', RO: 'RO', BE: 'BE', FI: 'FI', AE: 'UAE', XX: '\u2014' };
    var countryNamesFull = { GB: 'United Kingdom', US: 'United States', CA: 'Canada', AU: 'Australia', DE: 'Germany', FR: 'France', IE: 'Ireland', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', IN: 'India', JP: 'Japan', DK: 'Denmark', SE: 'Sweden', NO: 'Norway', TH: 'Thailand', NZ: 'New Zealand', RO: 'Romania', BE: 'Belgium', FI: 'Finland', AE: 'United Arab Emirates', XX: '\u2014' };

    function countryLabel(code) {
      if (!code) return 'Unknown';
      var c = (code || 'XX').toUpperCase().slice(0, 2);
      return countryNames[c] || c;
    }

    function countryLabelFull(code) {
      if (!code) return 'Unknown';
      var c = (code || 'XX').toUpperCase().slice(0, 2);
      return countryNamesFull[c] || countryNames[c] || c;
    }

    // Add width=100 to hotlinked images (? or & depending on existing params).
    function hotImg(url) {
      if (typeof url !== 'string') return url;
      if (/^https?:\/\//i.test(url)) {
        try {
          const u = new URL(url);
          u.searchParams.set('width', '100');
          return u.toString();
        } catch (_) {
          return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'width=100';
        }
      }
      return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'width=100';
    }
    // Product thumbs: request square (width + height) so object-fit: cover gives identical framing.
    function hotImgSquare(url) {
      if (typeof url !== 'string') return url;
      if (/^https?:\/\//i.test(url)) {
        try {
          const u = new URL(url);
          u.searchParams.set('width', '100');
          u.searchParams.set('height', '100');
          if (u.hostname.includes('shopify.com')) u.searchParams.set('crop', 'center');
          return u.toString();
        } catch (_) {
          const sep = url.indexOf('?') >= 0 ? '&' : '?';
          return url + sep + 'width=100&height=100';
        }
      }
      return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'width=100&height=100';
    }

    function flagImg(code, label) {
      const raw = (code || '').toString().trim().toLowerCase();
      const safeLabel = label != null ? String(label) : (code ? String(code) : '?');
      const titleAttr = label ? ' title="' + escapeHtml(safeLabel) + '"' : '';
      if (!raw || raw === 'xx' || !/^[a-z]{2}$/.test(raw)) {
        return '<span class="flag flag-xs flag-country-xx"' + titleAttr + ' aria-label="' + escapeHtml(safeLabel) + '"></span>';
      }
      return '<span class="flag flag-xs flag-country-' + raw + '"' + titleAttr + ' aria-label="' + escapeHtml(safeLabel) + '"></span>';
    }

    function flagImgSmall(code) {
      const raw = (code || '').toString().trim().toLowerCase();
      if (!raw || raw === 'xx' || !/^[a-z]{2}$/.test(raw)) {
        return '<span class="flag flag-xs flag-country-xx" aria-hidden="true"></span>';
      }
      return '<span class="flag flag-xs flag-country-' + raw + '" aria-hidden="true"></span>';
    }

    function arrivedAgo(startedAt) {
      var n = toMs(startedAt);
      if (n == null) return '\u2014';
      var s = Math.floor((Date.now() - n) / 1000);
      if (s < 60) return s + ' secs ago';
      if (s < 3600) return Math.floor(s / 60) + ' mins ago';
      if (s < 86400) return Math.floor(s / 3600) + ' hrs ago';
      return Math.floor(s / 86400) + ' days ago';
    }

    var storeBaseUrlFallback = '';
    var mainBaseUrlFallback = '';
    var assetsBaseUrlFallback = '';
    var shopForSalesFallback = '';
    var storeBaseUrlLoaded = false;
    (function fetchStoreBaseUrl() {
      fetch(API + '/api/store-base-url', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d) {
            if (d.baseUrl) storeBaseUrlFallback = d.baseUrl;
            if (d.mainBaseUrl) mainBaseUrlFallback = d.mainBaseUrl;
            if (d.assetsBaseUrl) assetsBaseUrlFallback = d.assetsBaseUrl;
            if (d.shopForSales) shopForSalesFallback = d.shopForSales;
            if (sessions.length) renderTable();
            if (assetsBaseUrlFallback) {
              var link = document.querySelector('link[rel="icon"]');
              if (link) link.href = '/assets/favicon.png';
              if (typeof saleAudio !== 'undefined' && saleAudio) saleAudio.src = CASH_REGISTER_MP3_URL;
            }
            if (shopForSalesFallback) {
              if (activeMainTab === 'products' && typeof refreshProducts === 'function') refreshProducts({ force: false });
              if (activeMainTab === 'stats' && typeof refreshStats === 'function') refreshStats({ force: false });
              if ((activeMainTab === 'channels' || activeMainTab === 'type') && typeof refreshTraffic === 'function') refreshTraffic({ force: false });
            }
          }
          storeBaseUrlLoaded = true;
          if (typeof renderSales === 'function') renderSales(statsCache);
        })
        .catch(function() { storeBaseUrlLoaded = true; if (typeof renderSales === 'function') renderSales(statsCache); });
    })();

    function getShopForSales() {
      var shop = getShopParam() || shopForSalesFallback || null;
      return shop && /\.myshopify\.com$/i.test(shop) ? shop : null;
    }

    function getStoreBaseUrl() {
      var params = new URLSearchParams(window.location.search);
      var shop = params.get('shop');
      if (shop && /\.myshopify\.com$/i.test(shop)) return 'https://' + shop;
      return storeBaseUrlFallback || '';
    }
    function getMainBaseUrl() {
      if (mainBaseUrlFallback) return mainBaseUrlFallback;
      return getStoreBaseUrl();
    }
    function getAssetsBase() {
      if (assetsBaseUrlFallback) return assetsBaseUrlFallback;
      return (API || '') + '/assets';
    }

    var HICON_URL = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/hicon.webp?v=1770084894');
    var DOLLAR_URL = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/dollar.png?v=1770085223');
    // Sale toast chime: load from Shopify CDN (do not rely on a repo-local MP3 file).
    var CASH_REGISTER_MP3_URL = 'https://cdn.shopify.com/s/files/1/0847/7261/8587/files/cash-register.mp3?v=1770171264';

    function titleCaseFromHandle(handle) {
      if (typeof handle !== 'string') return null;
      let s = handle;
      try { s = decodeURIComponent(s); } catch (_) {}
      s = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!s) return null;
      return s.split(' ').filter(Boolean).map(function(w) {
        const lower = w.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }).join(' ');
    }

    function productTitleFromPath(path) {
      if (typeof path !== 'string') return null;
      const m = path.trim().match(/^\/products\/([^/?#]+)/i);
      if (!m) return null;
      return titleCaseFromHandle(m[1]);
    }

    /** For display: /collections/bracelets -> Bracelets, /products/foo -> title-cased product name, else null. */
    function friendlyLabelFromPath(path) {
      if (typeof path !== 'string') return null;
      const p = path.trim();
      const pNorm = p.replace(/\/+$/, '') || '/';
      if (pNorm === '/pages/order-tracker') return 'Order Tracker';
      if (pNorm === '/pages/contact') return 'Contact';
      if (pNorm === '/account/login' || pNorm.startsWith('/account/login/')) return 'Login';
      if (pNorm === '/orders' || pNorm.startsWith('/orders/')) return 'Viewed Order';
      const collectionsMatch = p.match(/^\/collections\/([^/?#]+)/i);
      if (collectionsMatch) return titleCaseFromHandle(collectionsMatch[1]);
      const productsMatch = p.match(/^\/products\/([^/?#]+)/i);
      if (productsMatch) return titleCaseFromHandle(productsMatch[1]);
      return null;
    }

    function landingSortKey(s) {
      function trimStr(v) { return v != null ? String(v).trim() : ''; }
      function normalizeToPath(pathVal, handleVal) {
        var path = trimStr(pathVal);
        var handle = trimStr(handleVal);
        if (!path && handle) path = '/products/' + handle.replace(/^\/+/, '');
        if (path && !path.startsWith('/')) path = '/' + path;
        try {
          if (/^https?:\/\//i.test(path)) path = new URL(path).pathname || '/';
        } catch (_) {}
        path = (path || '').split('#')[0].split('?')[0];
        path = path.replace(/\/+$/, '');
        if (path === '') path = '/';
        return path;
      }
      function collapseKey(path) {
        if (!path) return '';
        var pathNorm = path.replace(/\/+$/, '');
        if (path.indexOf('/checkouts') === 0) return '/checkouts';
        if (pathNorm === '/cart') return '/cart';
        if (path === '/orders' || pathNorm === '/orders' || path.indexOf('/orders/') === 0) return '/orders';
        return path;
      }

      var path = normalizeToPath(s && s.first_path, s && s.first_product_handle);
      var key = collapseKey(path);
      if (!key) return '';
      if (key === '/') return 'Home';
      if (key === '/orders') return 'Viewed Order';
      if (key === '/cart' || key === '/checkouts') return 'Cart';
      return friendlyLabelFromPath(key) || key;
    }

    function visitsCount(s) {
      var n = 0;
      try { n = s && s.returning_count != null ? Number(s.returning_count) : 0; } catch (_) { n = 0; }
      if (!Number.isFinite(n)) n = 0;
      return n + 1;
    }

    function landingPageCell(s) {
      function trimStr(v) { return v != null ? String(v).trim() : ''; }
      function normalizeToPathDual(pathVal, handleVal) {
        var path = trimStr(pathVal);
        var handle = trimStr(handleVal);
        if (!path && !handle) return '';
        if (!path && handle) path = '/products/' + handle.replace(/^\/+/, '');
        if (path && !path.startsWith('/')) path = '/' + path;
        try {
          if (/^https?:\/\//i.test(path)) path = new URL(path).pathname || '/';
        } catch (_) {}
        path = path.split('#')[0].split('?')[0];
        path = path.replace(/\/+$/, '');
        if (path === '') path = '/';
        return path;
      }
      function collapseKeyDual(path) {
        if (!path) return '';
        if (path.indexOf('/checkouts') === 0) return '/checkouts';
        if (path === '/cart') return '/cart';
        if (path === '/orders' || path.indexOf('/orders/') === 0) return '/orders';
        return path;
      }

      var entryPathDual = normalizeToPathDual(s && s.first_path, s && s.first_product_handle);
      var exitPathDual = normalizeToPathDual(s && s.last_path, s && s.last_product_handle);
      var entryKeyDual = collapseKeyDual(entryPathDual);
      var exitKeyDual = collapseKeyDual(exitPathDual);

      // When we have BOTH entry + exit, show them both (otherwise keep the current single-thumb layout).
      if (entryPathDual && exitPathDual && entryKeyDual && exitKeyDual && entryKeyDual !== exitKeyDual) {
        var mainBaseDual = getMainBaseUrl();
        var isPurchasedDual = !!(s && s.has_purchased);

        function metaForDual(path) {
          var pathNorm = path ? path.replace(/\/+$/, '') : '';
          var isCheckout = path && path.indexOf('/checkouts') === 0;
          var isHomeOrOrders = path === '/' || path === '/orders' || pathNorm === '/orders' || (path && path.startsWith('/orders/'));
          var isCart = path === '/cart' || pathNorm === '/cart';
          var fullUrl = mainBaseDual && path ? mainBaseDual + path : '';
          var labelText = '\u2014';
          var thumbSrc = '';
          if (isHomeOrOrders) {
            labelText = path === '/' ? 'Home' : 'Viewed Order';
            thumbSrc = HICON_URL;
          } else if (isCart) {
            labelText = 'Cart';
            thumbSrc = HICON_URL;
          } else if (isCheckout) {
            labelText = 'Cart';
            // Prefer a product thumb when possible (even if the session didn't purchase).
            var ph = '';
            try {
              ph = (s && s.last_product_handle != null ? String(s.last_product_handle).trim() : '') ||
                   (s && s.first_product_handle != null ? String(s.first_product_handle).trim() : '');
            } catch (_) { ph = ''; }
            if (ph && mainBaseDual) {
              thumbSrc = (API || '') + '/api/og-thumb?url=' + encodeURIComponent(mainBaseDual + '/products/' + ph.replace(/^\/+/, '')) + '&width=100';
            } else {
              thumbSrc = HICON_URL;
            }
          } else if (path) {
            labelText = friendlyLabelFromPath(path) || path;
            if (fullUrl) thumbSrc = (API || '') + '/api/og-thumb?url=' + encodeURIComponent(fullUrl) + '&width=100';
          }
          return { fullUrl, labelText, thumbSrc };
        }

        var entryMeta = metaForDual(entryPathDual);
        var exitMeta = metaForDual(exitPathDual);

        var entryImg = entryMeta.thumbSrc
          ? '<img class="landing-thumb" src="' + entryMeta.thumbSrc + '" alt="" onerror="this.classList.add(\'is-hidden\')">'
          : '';
        var exitImg = exitMeta.thumbSrc
          ? '<img class="landing-thumb landing-thumb-exit" src="' + exitMeta.thumbSrc + '" alt="" onerror="this.classList.add(\'is-hidden\')">'
          : '';
        var thumbsInner = entryImg + exitImg;
        var overlay = isPurchasedDual
          ? '<span class="thumb-overlay" aria-hidden="true">' + BOUGHT_OVERLAY_SVG + '</span>'
          : '';
        var hasBoth = entryImg && exitImg;
        var wrapClass = hasBoth ? 'thumb-wrap thumb-stack' : 'thumb-wrap';
        var thumbs = thumbsInner ? ('<span class="' + wrapClass + '">' + thumbsInner + overlay + '</span>') : '';

        function dirArrowSvg(kind) {
          var isExit = kind === 'exit';
          var cls = 'landing-dir-icon ' + (isExit ? 'landing-dir-icon-exit' : 'landing-dir-icon-entry');
          var path = isExit
            ? '<path d="M19 12H5M11 6l-6 6 6 6"></path>'
            : '<path d="M5 12h14M13 6l6 6-6 6"></path>';
          return '<svg class="' + cls + '" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
        }

        function line(kind, meta) {
          var isExit = kind === 'exit';
          var prefix = isExit ? 'Exit' : 'Entry';
          var label = meta && meta.labelText ? String(meta.labelText) : '\u2014';
          var inner = dirArrowSvg(kind) +
            '<span class="landing-line-text"><span class="sr-only">' + prefix + ': </span>' + escapeHtml(label) + '</span>';
          if (meta && meta.fullUrl) {
            return '<a class="landing-line" href="' + escapeHtml(meta.fullUrl) + '" target="_blank" rel="noopener">' + inner + '</a>';
          }
          return '<span class="landing-line">' + inner + '</span>';
        }

        var lines = '<div class="landing-lines">' + line('entry', entryMeta) + line('exit', exitMeta) + '</div>';
        return '<div class="last-action-cell dual">' + thumbs + ' ' + lines + '</div>';
      }

      var hasFirst = (s.first_path != null && s.first_path !== '') || (s.first_product_handle != null && s.first_product_handle !== '');
      var path = (s.first_path != null && s.first_path !== '' ? s.first_path : (hasFirst ? '' : (s.last_path != null ? s.last_path : ''))).trim();
      var productHandle = s.first_product_handle != null && s.first_product_handle !== '' ? s.first_product_handle : (hasFirst ? null : (s.last_product_handle != null ? s.last_product_handle : null));
      var isFromLast = !hasFirst && (path || productHandle);
      if (path && !path.startsWith('/')) path = '/' + path;
      if (!path && productHandle) path = '/products/' + (productHandle || '');
      var pathNorm = path ? path.replace(/\/+$/, '') : '';
      var isCheckout = path && path.indexOf('/checkouts') === 0;
      var isHomeOrOrders = path === '/' || path === '/orders' || pathNorm === '/orders' || (path && path.startsWith('/orders/'));
      var isCart = path === '/cart' || pathNorm === '/cart';
      var mainBase = getMainBaseUrl();
      var fullUrl = mainBase && path ? mainBase + path : '';
      var label = '\u2014';
      var thumbSrc = '';
      var isPurchased = !!(s && s.has_purchased);
      // Keep the Landing Page thumbnail stable even after purchase; do not swap to a "sale" icon.
      if (isHomeOrOrders) {
        label = path === '/' ? 'Home' : 'Viewed Order';
        thumbSrc = HICON_URL;
      } else if (isCart) {
        label = 'Cart';
        thumbSrc = HICON_URL;
      } else if (isCheckout) {
        label = 'Cart';
        // Prefer a product thumb when possible (even if the session didn't purchase).
        var ph = '';
        try {
          ph = (s && s.last_product_handle != null ? String(s.last_product_handle).trim() : '') ||
               (s && s.first_product_handle != null ? String(s.first_product_handle).trim() : '');
        } catch (_) { ph = ''; }
        if (ph && mainBase) {
          thumbSrc = (API || '') + '/api/og-thumb?url=' + encodeURIComponent(mainBase + '/products/' + ph.replace(/^\/+/, '')) + '&width=100';
        } else {
          thumbSrc = HICON_URL;
        }
      } else if (path) {
        // Display friendly name: /collections/bracelets -> Bracelets, /products/<handle> -> title-cased (link unchanged).
        label = escapeHtml(friendlyLabelFromPath(path) || path);
        if (fullUrl) thumbSrc = (API || '') + '/api/og-thumb?url=' + encodeURIComponent(fullUrl) + '&width=100';
      }
      if (isFromLast && label !== '\u2014') label += ' <span class="landing-fallback-hint">(last)</span>';
      if (thumbSrc || fullUrl) {
        var img = '';
        if (thumbSrc) {
          img = isPurchased
            ? '<span class="thumb-wrap"><img class="landing-thumb" src="' + thumbSrc + '" alt="" onerror="this.parentNode && this.parentNode.classList && this.parentNode.classList.add(\'is-hidden\')"><span class="thumb-overlay" aria-hidden="true">' + BOUGHT_OVERLAY_SVG + '</span></span>'
            : '<img class="landing-thumb" src="' + thumbSrc + '" alt="" onerror="this.classList.add(\'is-hidden\')">';
        }
        var link = fullUrl ? '<a href="' + escapeHtml(fullUrl) + '" target="_blank" rel="noopener">' + label + '</a>' : label;
        return '<div class="last-action-cell">' + img + ' ' + link + '</div>';
      }
      return label === '\u2014' ? label : escapeHtml(path || '');
    }

    function formatMoney(amount, currencyCode) {
      if (amount == null || typeof amount !== 'number') return '';
      const code = (currencyCode || 'GBP').toUpperCase();
      const sym = code === 'GBP' ? '\u00A3' : code === 'USD' ? '$' : code === 'EUR' ? '\u20AC' : code + ' ';
      return sym + (amount % 1 === 0 ? amount : amount.toFixed(2));
    }

    function formatCompactNumber(amount) {
      const raw = typeof amount === 'number' ? amount : Number(amount);
      const n = Number.isFinite(raw) ? Math.abs(raw) : 0;
      if (n < 1000) return String(Math.round(n));
      if (n >= 1e9) {
        const v = n / 1e9;
        const dec = v < 100 ? 1 : 0;
        return v.toFixed(dec).replace(/\.0$/, '') + 'b';
      }
      if (n >= 1e6) {
        const v = n / 1e6;
        const dec = v < 100 ? 1 : 0;
        return v.toFixed(dec).replace(/\.0$/, '') + 'm';
      }
      // n >= 1e3
      const v = n / 1e3;
      const dec = v < 100 ? 1 : 0;
      return v.toFixed(dec).replace(/\.0$/, '') + 'k';
    }

    function formatMoneyCompact(amount, currencyCode) {
      if (amount == null || typeof amount !== 'number') return '';
      const code = (currencyCode || 'GBP').toUpperCase();
      const sym = code === 'GBP' ? '\u00A3' : code === 'USD' ? '$' : code === 'EUR' ? '\u20AC' : code + ' ';
      const n = Number.isFinite(amount) ? amount : 0;
      const sign = n < 0 ? '-' : '';
      return sign + sym + formatCompactNumber(n);
    }

    function sourceLabel(s) {
      const parts = [];
      if (s.utm_source && String(s.utm_source).trim()) parts.push('utm_source: ' + escapeHtml(String(s.utm_source).trim()));
      if (s.utm_campaign && String(s.utm_campaign).trim()) parts.push('utm_campaign: ' + escapeHtml(String(s.utm_campaign).trim()));
      if (s.utm_medium && String(s.utm_medium).trim()) parts.push('utm_medium: ' + escapeHtml(String(s.utm_medium).trim()));
      if (s.utm_content && String(s.utm_content).trim()) parts.push('utm_content: ' + escapeHtml(String(s.utm_content).trim()));
      if (s.referrer && String(s.referrer).trim()) parts.push('referrer: ' + escapeHtml(String(s.referrer).trim()));
      return parts.join(' ');
    }

    function sourceUtmString(s) {
      return [s.utm_source, s.utm_campaign, s.utm_medium, s.utm_content].filter(Boolean).join(' ').toLowerCase();
    }

    function isGoogleAdsSource(s) {
      return sourceUtmString(s).indexOf('googleads') !== -1;
    }

    /** Derive friendly source name from referrer URL host (when no UTM). Use for tooltip and to collect images. */
    function sourceReferrerFriendlyLabel(s) {
      const ref = s.referrer && String(s.referrer).trim();
      if (!ref) return null;
      try {
        const u = new URL(ref);
        const host = (u.hostname || '').toLowerCase().replace(/^www\./, '');
        if (!host) return null;
        if (host === 'account.heybigday.com') return 'HeyBigDay Account';
        if (host === 'account.hbdjewellery.com') return 'HBD Account';
        if (host === 'hbdjewellery.com' || host.endsWith('.myshopify.com')) return 'Store';
        if (host.indexOf('omnisend') !== -1) return 'Omnisend';
        if (host.indexOf('google') !== -1) return 'Google';
        if (host.indexOf('facebook') !== -1 || host.indexOf('fb.') === 0 || host === 'fb.com') return 'Facebook';
        if (host.indexOf('instagram') !== -1) return 'Instagram';
        if (host.indexOf('pinterest') !== -1) return 'Pinterest';
        if (host.indexOf('tiktok') !== -1) return 'TikTok';
        if (host.indexOf('twitter') !== -1 || host.indexOf('x.com') !== -1) return 'X (Twitter)';
        if (host.indexOf('youtube') !== -1) return 'YouTube';
        if (host.indexOf('linkedin') !== -1) return 'LinkedIn';
        if (host.indexOf('bing') !== -1) return 'Bing';
        if (host.indexOf('yahoo') !== -1) return 'Yahoo';
        if (host.indexOf('duckduckgo') !== -1) return 'DuckDuckGo';
        return host;
      } catch (_) { return null; }
    }

    function sourceFriendlyLabel(s) {
      const str = sourceUtmString(s);
      if (str) {
        if (str.indexOf('googleads') !== -1) return null;
        if (str.indexOf('google') !== -1) return 'Google';
        if (str.indexOf('bing') !== -1) return 'Bing';
        if (str.indexOf('omnisend') !== -1) return 'Omnisend';
        if (str.indexOf('chatgpt') !== -1 || str.indexOf('chat gpt') !== -1) return 'Chatgpt';
        return null;
      }
      return sourceReferrerFriendlyLabel(s);
    }

    function sourceSortKey(s) {
      try {
        const mapped = getMappedSourceKeysForSession(s);
        if (mapped && mapped.length) {
          const key0 = String(mapped[0] || '').trim().toLowerCase();
          if (key0) return trafficSourceLabelForKey(key0, key0) || key0;
        }
      } catch (_) {}
      if (isGoogleAdsSource(s)) return 'Google Ads';
      const friendly = sourceFriendlyLabel(s);
      if (friendly === 'Google') return 'Google';
      if (friendly) return friendly;
      if (sourceUtmString(s)) return 'Other';
      if (s.referrer && String(s.referrer).trim()) return 'Other';
      return 'Direct';
    }

    const SOURCE_GOOGLE_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/google.png?v=1770086632');
    const SOURCE_DIRECT_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/arrow-right.png?v=1770086632');
    const BOUGHT_OVERLAY_SVG = '<svg width="25" height="25" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="currentColor"></circle><path d="M11.087 14.815v-2.332c0-3.676 2.219-5.983 6.075-5.983 2.932 0 4.57 1.242 5.838 2.84l-2.483 1.9c-.951-1.165-1.85-1.85-3.328-1.85-1.77 0-2.827 1.217-2.827 3.17v2.255h6.578v2.637h-6.578v4.335h8.585V24.5H9v-1.977l2.087-.609v-4.462H9v-2.637z" fill="#ffffff"></path></svg>';
    const SOURCE_UNKNOWN_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/question.png?v=1770135816');
    const SOURCE_OMNISEND_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/omnisend.png?v=1770141052');
    const SOURCE_BING_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/bing.png?v=1770141094');
    const SOURCE_LIVEVIEW_SOURCE_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/liveview-source-logo.png?v=1770141081');

    // Traffic source mapping (server-configurable)
    const TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'utm_id',
      'utm_source_platform',
      'utm_creative_format',
      'utm_marketing_tactic',
      'utm_name',
      'utm_cid',
      'utm_referrer',
      'utm_reader',
    ];
    const TRAFFIC_SOURCE_MAP_ALLOWED_PARAM_SET = new Set(TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS);

    let trafficSourceMetaByKey = new Map(); // key -> { label, iconUrl, updatedAt }
    let trafficSourceRulesIndex = new Map(); // param -> value -> [source_key]
    let trafficSourceMetaLoadedAt = 0;
    let trafficSourceMetaInFlight = null;

    function safeUrlParams(url) {
      const raw = url != null ? String(url).trim() : '';
      if (!raw) return null;
      try { return new URL(raw).searchParams; } catch (_) {}
      try { return new URL('https://' + raw).searchParams; } catch (_) {}
      return null;
    }

    function normalizeUtmParam(v) {
      const s = v != null ? String(v).trim().toLowerCase() : '';
      if (!s) return '';
      return TRAFFIC_SOURCE_MAP_ALLOWED_PARAM_SET.has(s) ? s : '';
    }

    function normalizeUtmValue(v) {
      const s = v != null ? String(v).trim() : '';
      if (!s) return '';
      return (s.length > 256 ? s.slice(0, 256) : s).toLowerCase();
    }

    function buildTrafficSourceRulesIndex(rules) {
      const idx = new Map();
      (Array.isArray(rules) ? rules : []).forEach(function(r) {
        const p = normalizeUtmParam(r && r.utm_param);
        const v = normalizeUtmValue(r && r.utm_value);
        const k = (r && r.source_key != null) ? String(r.source_key).trim().toLowerCase() : '';
        if (!p || !v || !k) return;
        if (!idx.has(p)) idx.set(p, new Map());
        const byVal = idx.get(p);
        if (!byVal.has(v)) byVal.set(v, []);
        byVal.get(v).push(k);
      });
      return idx;
    }

    function refreshTrafficSourceMeta(options = {}) {
      const force = !!options.force;
      const now = Date.now();
      if (!force && trafficSourceMetaLoadedAt && (now - trafficSourceMetaLoadedAt) < 60 * 1000) {
        return Promise.resolve({ ok: true, cached: true });
      }
      if (trafficSourceMetaInFlight) return trafficSourceMetaInFlight;
      trafficSourceMetaInFlight = fetchWithTimeout(API + '/api/traffic-source-meta' + (force ? ('?_=' + now) : ''), { credentials: 'same-origin', cache: 'no-store' }, 20000)
        .then(function(r) { if (!r.ok) throw new Error('Meta HTTP ' + r.status); return r.json(); })
        .then(function(json) {
          const meta = (json && json.meta && typeof json.meta === 'object') ? json.meta : {};
          const m = new Map();
          Object.keys(meta).forEach(function(k) {
            const kk = String(k || '').trim().toLowerCase();
            if (!kk) return;
            const v = meta[k] || {};
            m.set(kk, {
              label: v && v.label != null ? String(v.label) : kk,
              iconUrl: v && v.iconUrl != null ? String(v.iconUrl) : (v && v.icon_url != null ? String(v.icon_url) : null),
              updatedAt: v && v.updatedAt != null ? Number(v.updatedAt) : (v && v.updated_at != null ? Number(v.updated_at) : null),
            });
          });
          const rules = (json && Array.isArray(json.rules)) ? json.rules : [];
          trafficSourceMetaByKey = m;
          trafficSourceRulesIndex = buildTrafficSourceRulesIndex(rules);
          trafficSourceMetaLoadedAt = Date.now();
          try { if (trafficCache) renderTraffic(trafficCache); } catch (_) {}
          try { if (sessions && sessions.length) renderTable(); } catch (_) {}
          return { ok: true, metaCount: m.size, ruleCount: rules.length };
        })
        .catch(function(err) {
          console.error(err);
          return { ok: false, error: err && err.message ? String(err.message) : 'Failed' };
        })
        .finally(function() { trafficSourceMetaInFlight = null; });
      return trafficSourceMetaInFlight;
    }

    function trafficSourceLabelForKey(key, fallbackLabel) {
      const k = key != null ? String(key).trim().toLowerCase() : '';
      if (!k) return fallbackLabel != null ? String(fallbackLabel) : '';
      const meta = trafficSourceMetaByKey.get(k);
      if (meta && meta.label != null && String(meta.label).trim() !== '') return String(meta.label);
      return fallbackLabel != null ? String(fallbackLabel) : k;
    }

    function trafficSourceIconUrlForKey(key) {
      const k = key != null ? String(key).trim().toLowerCase() : '';
      if (!k) return '';
      const meta = trafficSourceMetaByKey.get(k);
      return meta && meta.iconUrl != null && String(meta.iconUrl).trim() !== '' ? String(meta.iconUrl).trim() : '';
    }

    function extractMappedUtmTokensFromSession(s) {
      const out = [];
      function add(param, value) {
        const p = normalizeUtmParam(param);
        const v = normalizeUtmValue(value);
        if (!p || !v) return;
        out.push({ param: p, value: v });
      }
      const params = safeUrlParams(s && s.entry_url ? String(s.entry_url) : '');
      if (params) {
        TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS.forEach(function(p) {
          const v = params.get(p);
          if (v != null && String(v).trim() !== '') add(p, v);
        });
      }
      add('utm_source', s && s.utm_source != null ? String(s.utm_source) : '');
      add('utm_medium', s && s.utm_medium != null ? String(s.utm_medium) : '');
      add('utm_campaign', s && s.utm_campaign != null ? String(s.utm_campaign) : '');
      add('utm_content', s && s.utm_content != null ? String(s.utm_content) : '');

      const seen = new Set();
      const deduped = [];
      out.forEach(function(t) {
        const k = t.param + '\0' + t.value;
        if (seen.has(k)) return;
        seen.add(k);
        deduped.push(t);
      });
      return deduped;
    }

    function getMappedSourceKeysForSession(s) {
      const tokens = extractMappedUtmTokensFromSession(s);
      if (!tokens.length) return [];
      const out = [];
      const seen = new Set();
      tokens.forEach(function(t) {
        const byVal = trafficSourceRulesIndex.get(t.param);
        if (!byVal) return;
        const keys = byVal.get(t.value);
        if (!Array.isArray(keys) || !keys.length) return;
        // Newest mapping wins (rules are appended; API preserves created order).
        for (let i = keys.length - 1; i >= 0; i--) {
          const kk = String(keys[i] || '').trim().toLowerCase();
          if (!kk || seen.has(kk)) continue;
          seen.add(kk);
          out.push(kk);
        }
      });
      return out;
    }

    function trafficSourceBuiltInIconSrc(key) {
      const k = key != null ? String(key).trim().toLowerCase() : '';
      if (!k) return '';
      if (k === 'google_ads') return getAssetsBase() + '/adwords.png?width=100';
      if (k === 'google_organic') return SOURCE_GOOGLE_IMG;
      if (k === 'bing_ads' || k === 'bing_organic') return SOURCE_BING_IMG;
      if (k === 'omnisend') return SOURCE_OMNISEND_IMG;
      if (k === 'direct') return SOURCE_DIRECT_IMG;
      return SOURCE_UNKNOWN_IMG;
    }

    // Config modal: source mapping UI
    let trafficSourceMapsShowMappedTokens = false;
    let trafficSourceMapsUiInFlight = null;

    function fetchTrafficSourceMaps(options = {}) {
      const sinceDays = (options && typeof options.sinceDays === 'number') ? options.sinceDays : 30;
      const limitTokens = (options && typeof options.limitTokens === 'number') ? options.limitTokens : 250;
      const unmappedOnly = options && options.unmappedOnly != null ? !!options.unmappedOnly : !trafficSourceMapsShowMappedTokens;
      let url = API + '/api/traffic-source-maps?sinceDays=' + encodeURIComponent(String(sinceDays)) +
        '&limitTokens=' + encodeURIComponent(String(limitTokens)) +
        '&unmappedOnly=' + encodeURIComponent(unmappedOnly ? '1' : '0');
      url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 25000)
        .then(function(r) { if (!r.ok) throw new Error('Maps HTTP ' + r.status); return r.json(); });
    }

    function postTrafficSourceMap(payload) {
      return fetchWithTimeout(API + '/api/traffic-source-maps/map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload || {}),
      }, 45000).then(function(r) { return r.ok ? r.json() : r.json().catch(function() { return null; }).then(function(j) { throw new Error((j && j.error) ? j.error : ('HTTP ' + r.status)); }); });
    }

    function postTrafficSourceMeta(payload) {
      return fetchWithTimeout(API + '/api/traffic-source-maps/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload || {}),
      }, 25000).then(function(r) { return r.ok ? r.json() : r.json().catch(function() { return null; }).then(function(j) { throw new Error((j && j.error) ? j.error : ('HTTP ' + r.status)); }); });
    }

    function postTrafficSourceBackfill(payload) {
      return fetchWithTimeout(API + '/api/traffic-source-maps/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload || {}),
      }, 60000).then(function(r) { return r.ok ? r.json() : null; });
    }

    // Preserve token editor inputs across refreshes (bulk mapping UX).
    // Keyed by utm_param + utm_value so "Refresh/Scan/Show mapped tokens" won't wipe in-progress edits.
    let trafficSourceTokenDrafts = new Map(); // tokenKey -> { sourcePick, sourceLabel, iconUrl }

    function normalizeFlatLabel(v) {
      const s = v != null ? String(v).trim().toLowerCase() : '';
      if (!s) return '';
      return s.replace(/[^a-z0-9]+/g, '');
    }

    function tokenDraftKey(utmParam, utmValue) {
      const p = utmParam != null ? String(utmParam).trim().toLowerCase() : '';
      const v = utmValue != null ? String(utmValue).trim().toLowerCase() : '';
      if (!p || !v) return '';
      return p + '\u0000' + v;
    }

    function setTokenRowOtherMode(row, on) {
      const otherEl = row ? row.querySelector('input[data-field="source_label"]') : null;
      if (otherEl) otherEl.classList.toggle('is-hidden', !on);
    }

    function readTokenDraftFromRow(row) {
      const pickEl = row ? row.querySelector('select[data-field="source_pick"]') : null;
      const labelEl = row ? row.querySelector('input[data-field="source_label"]') : null;
      const iconEl = row ? row.querySelector('input[data-field="icon_url"]') : null;
      const pick = pickEl ? String(pickEl.value || '').trim().toLowerCase() : '';
      const sourceLabel = labelEl ? String(labelEl.value || '') : '';
      const iconUrl = iconEl ? String(iconEl.value || '') : '';
      return { sourcePick: pick, sourceLabel, iconUrl };
    }

    function upsertTokenDraft(key, draft) {
      if (!key) return;
      const pick = draft && draft.sourcePick != null ? String(draft.sourcePick).trim().toLowerCase() : '';
      const label = draft && draft.sourceLabel != null ? String(draft.sourceLabel) : '';
      const icon = draft && draft.iconUrl != null ? String(draft.iconUrl) : '';
      const labelTrim = label.trim();
      const iconTrim = icon.trim();
      const meaningful = (!!pick) || (!!labelTrim) || (!!iconTrim);
      if (!meaningful || (pick === '__other__' && !labelTrim && !iconTrim)) {
        trafficSourceTokenDrafts.delete(key);
        return;
      }
      trafficSourceTokenDrafts.set(key, { sourcePick: pick, sourceLabel: label, iconUrl: icon });
    }

    function stashTokenDraftsFromRoot(root) {
      if (!root || !trafficSourceTokenDrafts || !trafficSourceTokenDrafts.size) return;
      const rows = root.querySelectorAll('.tsm-token-row');
      rows.forEach(function(row) {
        const p = (row.getAttribute('data-utm-param') || '').trim();
        const v = (row.getAttribute('data-utm-value') || '').trim();
        const key = tokenDraftKey(p, v);
        if (!key) return;
        if (!trafficSourceTokenDrafts.has(key)) return; // only update existing drafts (avoid making every row "dirty")
        upsertTokenDraft(key, readTokenDraftFromRow(row));
      });
    }

    function applyTokenDraftsToRoot(root) {
      if (!root || !trafficSourceTokenDrafts || !trafficSourceTokenDrafts.size) return;
      const rows = root.querySelectorAll('.tsm-token-row');
      rows.forEach(function(row) {
        const p = (row.getAttribute('data-utm-param') || '').trim();
        const v = (row.getAttribute('data-utm-value') || '').trim();
        const key = tokenDraftKey(p, v);
        if (!key) return;
        const d = trafficSourceTokenDrafts.get(key);
        if (!d) return;

        const pickEl = row.querySelector('select[data-field="source_pick"]');
        if (pickEl && d.sourcePick != null && String(d.sourcePick).trim() !== '') {
          pickEl.value = String(d.sourcePick).trim().toLowerCase();
        }

        const labelEl = row.querySelector('input[data-field="source_label"]');
        if (labelEl && d.sourceLabel != null) labelEl.value = String(d.sourceLabel);

        const iconEl = row.querySelector('input[data-field="icon_url"]');
        if (iconEl && d.iconUrl != null) iconEl.value = String(d.iconUrl);

        const pickNow = pickEl ? String(pickEl.value || '').trim().toLowerCase() : (d.sourcePick || '');
        const otherOn = (pickNow === '__other__') || (!!String(d.sourceLabel || '').trim() && (!pickNow || pickNow === '__other__'));
        setTokenRowOtherMode(row, otherOn);
      });
    }

    function setTsmSaveMsg(root, msg) {
      if (!root) return;
      const els = root.querySelectorAll('[data-tsm-save-msg]');
      els.forEach(function(el) { el.textContent = msg != null ? String(msg) : ''; });
    }

    function renderTrafficSourceMappingPanel(state) {
      const sources = (state && Array.isArray(state.sources)) ? state.sources.slice() : [];
      const tokens = (state && Array.isArray(state.tokens)) ? state.tokens.slice() : [];
      sources.sort(function(a, b) {
        const al = (a && a.label != null) ? String(a.label) : '';
        const bl = (b && b.label != null) ? String(b.label) : '';
        return al.localeCompare(bl);
      });

      function fmtTs(ms) { return (typeof ms === 'number' && isFinite(ms)) ? formatTs(ms) : '—'; }
      function tokenJumpId(p, v) {
        const s = String(p || '') + '\u0000' + String(v || '');
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return 'tsm-token-' + (h >>> 0).toString(16);
      }

      let html = '';
      html += '<div class="tsm-actions">';
      html +=   '<button type="button" class="tsm-btn primary" data-tsm-action="save-mappings">' + '<span>Save mappings</span>' + '</button>';
      html +=   '<button type="button" class="tsm-btn" data-tsm-action="refresh">' + '<span>Refresh</span>' + '</button>';
      html +=   '<button type="button" class="tsm-btn" data-tsm-action="scan">' + '<span>Scan last 30d</span>' + '</button>';
      html +=   '<button type="button" class="tsm-btn" data-tsm-action="toggle-mapped">' + '<span>' + (trafficSourceMapsShowMappedTokens ? 'Hide mapped tokens' : 'Show mapped tokens') + '</span>' + '</button>';
      html +=   '<span class="tsm-save-msg" data-tsm-save-msg></span>';
      html += '</div>';
      html += '<div class="diag-note">Unmapped tokens appear here first. Pick an existing Source (or choose <strong>Other…</strong>), then press <strong>Save mappings</strong> to apply in bulk. If you map a token again, the newest mapping wins. Paste an icon URL to override the default icon.</div>';

      html += '<div class="diag-section-title">' + '<span>Mapped sources</span>' + '</div>';
      if (!sources.length) {
        html += '<div class="diag-note">No sources yet.</div>';
      } else {
        // Quick-jump row for source meta (icons → scroll to source row)
        try {
          html += '<div class="tsm-jump-row" aria-label="Source shortcuts">';
          sources.forEach(function(s) {
            const key = s && s.source_key != null ? String(s.source_key).trim().toLowerCase() : '';
            if (!key) return;
            const label = s && s.label != null ? String(s.label) : key;
            const iconUrl = s && s.icon_url != null ? String(s.icon_url) : '';
            const builtIn = trafficSourceBuiltInIconSrc(key);
            const previewSrc = (iconUrl && iconUrl.trim())
              ? iconUrl.trim()
              : ((builtIn && builtIn !== SOURCE_UNKNOWN_IMG) ? builtIn : SOURCE_UNKNOWN_IMG);
            const targetId = 'tsm-source-' + key;
            html += '<button type="button" class="tsm-jump-btn" data-tsm-jump-source="' + escapeHtml(targetId) + '" title="' + escapeHtml(label) + '">' +
              '<img src="' + escapeHtml(hotImg(previewSrc) || previewSrc) + '" alt="" />' +
            '</button>';
          });
          html += '</div>';
        } catch (_) {}
        html += '<div class="tsm-table-scroll">';
        html +=   '<div class="grid-table tsm-table tsm-sources-grid" role="table" aria-label="Mapped sources">';
        html +=     '<div class="grid-header" role="rowgroup"><div class="grid-row grid-row--header" role="row">' +
                      '<div class="grid-cell" role="columnheader">Source</div>' +
                      '<div class="grid-cell" role="columnheader">Key</div>' +
                      '<div class="grid-cell" role="columnheader">Icon URL</div>' +
                      '<div class="grid-cell" role="columnheader"></div>' +
                    '</div></div></div>';
        html +=     '<div class="grid-body" role="rowgroup">';
        sources.forEach(function(s) {
          const key = s && s.source_key != null ? String(s.source_key).trim().toLowerCase() : '';
          if (!key) return;
          const label = s && s.label != null ? String(s.label) : key;
          const iconUrl = s && s.icon_url != null ? String(s.icon_url) : '';
          const builtIn = trafficSourceBuiltInIconSrc(key);
          const previewSrc = (iconUrl && iconUrl.trim())
            ? iconUrl.trim()
            : ((builtIn && builtIn !== SOURCE_UNKNOWN_IMG) ? builtIn : '');
          const preview = previewSrc
            ? ('<img class="tsm-icon-preview" src="' + escapeHtml(previewSrc) + '" alt="" onerror="this.classList.add(\'is-hidden\')">')
            : '<span class="tsm-icon-spacer" aria-hidden="true"></span>';
          html += '<div class="grid-row tsm-source-row" role="row" id="tsm-source-' + escapeHtml(key) + '" data-source-key="' + escapeHtml(key) + '">' +
            '<div class="grid-cell" role="cell"><input class="tsm-input" data-field="label" value="' + escapeHtml(label) + '" /></div>' +
            '<div class="grid-cell" role="cell"><code>' + escapeHtml(key) + '</code></div>' +
            '<div class="grid-cell" role="cell"><div class="tsm-icon-input-row">' +
              preview +
              '<input class="tsm-input" data-field="icon_url" placeholder="https://.../icon.png" value="' + escapeHtml(iconUrl || '') + '" />' +
            '</div></div>' +
            '<div class="grid-cell" role="cell"><button type="button" class="tsm-btn primary" data-tsm-action="save-meta">Save</button></div>' +
          '</div>';
        });
        html += '</div></div></div>';
      }

      html += '<div class="diag-section-title u-mt-md">' + '<span>' + (trafficSourceMapsShowMappedTokens ? 'Tokens (mapped + unmapped)' : 'Unmapped tokens') + '</span>' + '</div>';
      // Quick-jump row: show mapped token icons inline for fast navigation.
      try {
        const MAX_JUMPS = 120;
        const mappedTokens = [];
        tokens.forEach(function(t) {
          const p = t && t.utm_param != null ? String(t.utm_param).trim().toLowerCase() : '';
          const v = t && t.utm_value != null ? String(t.utm_value).trim().toLowerCase() : '';
          if (!p || !v) return;
          const mapped = (t && Array.isArray(t.mapped)) ? t.mapped : [];
          const currentKey = (mapped && mapped[0] && mapped[0].source_key != null) ? String(mapped[0].source_key).trim().toLowerCase() : '';
          if (!currentKey) return;
          const label = (mapped && mapped[0] && mapped[0].label != null) ? String(mapped[0].label) : currentKey;
          const mu = (mapped && mapped[0] && mapped[0].icon_url != null) ? String(mapped[0].icon_url) : '';
          let src = (mu && mu.trim()) ? mu.trim() : '';
          if (!src) {
            const bi = trafficSourceBuiltInIconSrc(currentKey);
            if (bi) src = bi;
          }
          if (!src) src = SOURCE_UNKNOWN_IMG;
          mappedTokens.push({
            jumpId: tokenJumpId(p, v),
            iconSrc: src,
            title: p + '=' + v + ' → ' + label,
          });
        });
        if (mappedTokens.length) {
          html += '<div class="tsm-jump-row" aria-label="Mapped token shortcuts">';
          mappedTokens.slice(0, MAX_JUMPS).forEach(function(it) {
            html += '<button type="button" class="tsm-jump-btn" data-tsm-jump="' + escapeHtml(it.jumpId) + '" title="' + escapeHtml(it.title) + '">' +
              '<img src="' + escapeHtml(hotImg(it.iconSrc) || it.iconSrc) + '" alt="" />' +
            '</button>';
          });
          if (mappedTokens.length > MAX_JUMPS) {
            html += '<span class="tsm-save-msg">+' + escapeHtml(String(mappedTokens.length - MAX_JUMPS)) + ' more</span>';
          }
          html += '</div>';
        }
      } catch (_) {}
      if (!tokens.length) {
        html += '<div class="diag-note">No tokens captured yet. Click <strong>Scan last 30d</strong> (or wait for new sessions) and they will appear here.</div>';
      } else {
        html += '<div class="tsm-table-scroll">';
        html +=   '<div class="grid-table tsm-table tsm-tokens-grid" role="table" aria-label="Tokens">';
        html +=     '<div class="grid-header" role="rowgroup"><div class="grid-row grid-row--header" role="row">' +
                      '<div class="grid-cell" role="columnheader">Token</div>' +
                      '<div class="grid-cell" role="columnheader">Seen</div>' +
                      '<div class="grid-cell" role="columnheader">Map / existing</div>' +
                    '</div></div></div>';
        html +=     '<div class="grid-body" role="rowgroup">';
        tokens.forEach(function(t) {
          const p = t && t.utm_param != null ? String(t.utm_param).trim().toLowerCase() : '';
          const v = t && t.utm_value != null ? String(t.utm_value).trim().toLowerCase() : '';
          if (!p || !v) return;
          const jumpId = tokenJumpId(p, v);
          const seenCount = t && typeof t.seen_count === 'number' ? t.seen_count : 0;
          const lastSeen = t && typeof t.last_seen_at === 'number' ? t.last_seen_at : null;
          const mapped = (t && Array.isArray(t.mapped)) ? t.mapped : [];
          const currentKey = (mapped && mapped[0] && mapped[0].source_key != null) ? String(mapped[0].source_key).trim().toLowerCase() : '';
          let opts = '<option value="">Choose…</option>';
          sources.forEach(function(s) {
            const sk = s && s.source_key != null ? String(s.source_key).trim().toLowerCase() : '';
            if (!sk) return;
            const sl = s && s.label != null ? String(s.label) : sk;
            opts += '<option value="' + escapeHtml(sk) + '"' + (sk === currentKey ? ' selected' : '') + '>' + escapeHtml(sl) + '</option>';
          });
          opts += '<option value="__other__">Other…</option>';

          html += '<div class="grid-row tsm-token-row" role="row" id="' + escapeHtml(jumpId) + '" data-utm-param="' + escapeHtml(p) + '" data-utm-value="' + escapeHtml(v) + '" data-current-source-key="' + escapeHtml(currentKey) + '">' +
            '<div class="grid-cell" role="cell"><code>' + escapeHtml(p) + '=' + escapeHtml(v) + '</code></div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(String(seenCount || 0)) + '<div class="diag-note tsm-seen-subnote">Last: ' + escapeHtml(fmtTs(lastSeen)) + '</div></div>' +
            '<div class="grid-cell" role="cell">' +
              '<div class="tsm-token-map-row">' +
                '<select class="tsm-input tsm-select" data-field="source_pick">' + opts + '</select>' +
                '<input class="tsm-input tsm-token-other is-hidden" data-field="source_label" placeholder="Other source…" />' +
                '<input class="tsm-input tsm-token-icon" data-field="icon_url" placeholder="Icon URL (optional)" />' +
              '</div>' +
              (mapped.length ? ('<div class="tsm-mapped-list">' + mapped.map(function(m) {
                const ml = m && m.label != null ? String(m.label) : (m && m.source_key ? String(m.source_key) : '');
                const mu = m && m.icon_url != null ? String(m.icon_url) : '';
                const mk = m && m.source_key != null ? String(m.source_key).trim().toLowerCase() : '';
                let prevSrc = (mu && mu.trim()) ? mu.trim() : '';
                if (!prevSrc && mk) {
                  const bi = trafficSourceBuiltInIconSrc(mk);
                  if (bi && bi !== SOURCE_UNKNOWN_IMG) prevSrc = bi;
                }
                const prev = prevSrc ? ('<img class="tsm-icon-preview" src="' + escapeHtml(prevSrc) + '" alt="" onerror="this.classList.add(\'is-hidden\')">') : '';
                return '<span class="tsm-mapped-pill">' + prev + escapeHtml(ml) + '</span>';
              }).join('') + '</div>') : '') +
            '</div>' +
          '</div>';
        });
        html += '</div></div></div>';
        html += '<div class="tsm-actions tsm-actions--footer">' +
          '<button type="button" class="tsm-btn primary" data-tsm-action="save-mappings">' + '<span>Save mappings</span>' + '</button>' +
          '<span class="tsm-save-msg" data-tsm-save-msg></span>' +
        '</div>';
      }

      return html;
    }

    function setTrafficSourceMappingFullscreen(on) {
      const modal = document.getElementById('traffic-sources-modal');
      if (!modal) return;
      modal.classList.toggle('tsm-fullscreen', !!on);
    }

    function bindTrafficSourceMappingFullscreen() {
      const details = document.getElementById('traffic-source-mapping-details');
      if (!details) return;
      if (details.getAttribute('data-tsm-fs-bound')) return;
      details.setAttribute('data-tsm-fs-bound', '1');
      details.addEventListener('toggle', function() {
        setTrafficSourceMappingFullscreen(!!details.open);
        if (details.open) {
          try { details.scrollIntoView({ block: 'start' }); } catch (_) {}
        }
      });
      setTrafficSourceMappingFullscreen(!!details.open);
    }

    let trafficSourceMapsLastState = null;
    let trafficSourceMapsLastLoadedAt = 0;

    function refreshTrafficSourceMappingPanel(options = {}) {
      const rootId = options && options.rootId ? String(options.rootId) : 'traffic-source-mapping-root';
      const root = document.getElementById(rootId);
      if (!root) return Promise.resolve(null);
      try { stashTokenDraftsFromRoot(root); } catch (_) {}
      const force = !!options.force;
      const now = Date.now();
      const fresh = !!(trafficSourceMapsLastState && trafficSourceMapsLastLoadedAt && (now - trafficSourceMapsLastLoadedAt) < 30 * 1000);
      if (!force && fresh) {
        root.innerHTML = renderTrafficSourceMappingPanel(trafficSourceMapsLastState);
        try { applyTokenDraftsToRoot(root); } catch (_) {}
        return Promise.resolve(trafficSourceMapsLastState);
      }

      root.innerHTML = '<div class="diag-loading">Loading\u2026</div>';

      if (trafficSourceMapsUiInFlight) {
        return trafficSourceMapsUiInFlight
          .then(function(state) {
            if (state && state.ok === true) {
              root.innerHTML = renderTrafficSourceMappingPanel(state);
              try { applyTokenDraftsToRoot(root); } catch (_) {}
            }
            else root.innerHTML = '<div class="diag-note">Failed to load source mapping.</div>';
            return state;
          })
          .catch(function(err) {
            console.error(err);
            root.innerHTML = '<div class="diag-note">Failed to load source mapping. ' + escapeHtml(err && err.message ? String(err.message) : '') + '</div>';
            return null;
          });
      }

      trafficSourceMapsUiInFlight = fetchTrafficSourceMaps({ force: true, unmappedOnly: !trafficSourceMapsShowMappedTokens })
        .then(function(json) {
          if (!json || json.ok !== true) throw new Error('Bad response');
          trafficSourceMapsLastState = json;
          trafficSourceMapsLastLoadedAt = Date.now();
          return json;
        })
        .catch(function(err) {
          console.error(err);
          return null;
        })
        .finally(function() { trafficSourceMapsUiInFlight = null; });

      return trafficSourceMapsUiInFlight.then(function(state) {
        if (state && state.ok === true) {
          root.innerHTML = renderTrafficSourceMappingPanel(state);
          try { applyTokenDraftsToRoot(root); } catch (_) {}
        }
        else root.innerHTML = '<div class="diag-note">Failed to load source mapping.</div>';
        return state;
      });
    }

    function initTrafficSourceMappingPanel(options = {}) {
      const rootId = options && options.rootId ? String(options.rootId) : 'traffic-source-mapping-root';
      const root = document.getElementById(rootId);
      if (!root) return;
      try { bindTrafficSourceMappingFullscreen(); } catch (_) {}

      // Draft-preserving editors (so Save/Refresh doesn't wipe other rows).
      root.onchange = function(e) {
        const el = e && e.target ? e.target : null;
        if (!el || !el.closest) return;
        const row = el.closest('.tsm-token-row');
        if (!row) return;
        const p = (row.getAttribute('data-utm-param') || '').trim();
        const v = (row.getAttribute('data-utm-value') || '').trim();
        const key = tokenDraftKey(p, v);
        if (!key) return;

        if (el.matches && el.matches('select[data-field="source_pick"]')) {
          const pick = String(el.value || '').trim().toLowerCase();
          setTokenRowOtherMode(row, pick === '__other__');
          if (pick === '__other__') {
            const otherEl = row.querySelector('input[data-field="source_label"]');
            if (otherEl) { try { otherEl.focus(); } catch (_) {} }
          }
        }

        upsertTokenDraft(key, readTokenDraftFromRow(row));
        try { setTsmSaveMsg(root, ''); } catch (_) {}
      };

      root.oninput = function(e) {
        const el = e && e.target ? e.target : null;
        if (!el || !el.closest) return;
        const row = el.closest('.tsm-token-row');
        if (!row) return;
        const p = (row.getAttribute('data-utm-param') || '').trim();
        const v = (row.getAttribute('data-utm-value') || '').trim();
        const key = tokenDraftKey(p, v);
        if (!key) return;
        upsertTokenDraft(key, readTokenDraftFromRow(row));
        try { setTsmSaveMsg(root, ''); } catch (_) {}
      };

      root.onclick = function(e) {
        const jump = e && e.target ? e.target.closest('[data-tsm-jump],[data-tsm-jump-source]') : null;
        if (jump) {
          const id = (jump.getAttribute('data-tsm-jump') || jump.getAttribute('data-tsm-jump-source') || '').trim();
          if (!id) return;
          const row = document.getElementById(id);
          if (row) {
            try { row.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) { try { row.scrollIntoView(true); } catch (_) {} }
            try {
              row.classList.remove('tsm-flash');
              // restart animation
              void row.offsetWidth;
              row.classList.add('tsm-flash');
              setTimeout(function() { try { row.classList.remove('tsm-flash'); } catch (_) {} }, 1400);
            } catch (_) {}
          }
          return;
        }
        const btn = e && e.target ? e.target.closest('button[data-tsm-action]') : null;
        if (!btn) return;
        const action = (btn.getAttribute('data-tsm-action') || '').trim();
        if (action === 'refresh') {
          refreshTrafficSourceMappingPanel({ force: true, rootId: rootId });
          return;
        }
        if (action === 'toggle-mapped') {
          trafficSourceMapsShowMappedTokens = !trafficSourceMapsShowMappedTokens;
          refreshTrafficSourceMappingPanel({ force: true, rootId: rootId });
          return;
        }
        if (action === 'scan') {
          btn.disabled = true;
          postTrafficSourceBackfill({ since_days: 30, limit_sessions: 20000 })
            .then(function() { return refreshTrafficSourceMappingPanel({ force: true, rootId: rootId }); })
            .finally(function() { btn.disabled = false; });
          return;
        }
        if (action === 'save-mappings') {
          const rootEl = root;
          const rows = Array.from(rootEl.querySelectorAll('.tsm-token-row'));

          // Capture any "dirty" rows into drafts (resilient even if a browser misses input events).
          try {
            rows.forEach(function(r) {
              const utmParam = (r.getAttribute('data-utm-param') || '').trim();
              const utmValue = (r.getAttribute('data-utm-value') || '').trim();
              const tkey = tokenDraftKey(utmParam, utmValue);
              if (!tkey) return;
              const currentKey = (r.getAttribute('data-current-source-key') || '').trim().toLowerCase();
              const pickEl = r.querySelector('select[data-field="source_pick"]');
              const pick = pickEl ? String(pickEl.value || '').trim().toLowerCase() : '';
              const labelEl = r.querySelector('input[data-field="source_label"]');
              const iconEl = r.querySelector('input[data-field="icon_url"]');
              const label = labelEl ? String(labelEl.value || '').trim() : '';
              const iconUrl = iconEl ? String(iconEl.value || '').trim() : '';
              const dirty = (pick === '__other__') || (!!label) || (!!iconUrl) || (!!pick && pick !== currentKey);
              if (!dirty) return;
              upsertTokenDraft(tkey, { sourcePick: pick, sourceLabel: label, iconUrl: iconUrl });
            });
          } catch (_) {}

          const jobs = [];
          rows.forEach(function(r) {
            const utmParam = (r.getAttribute('data-utm-param') || '').trim();
            const utmValue = (r.getAttribute('data-utm-value') || '').trim();
            if (!utmParam || !utmValue) return;
            const tkey = tokenDraftKey(utmParam, utmValue);
            const currentKey = (r.getAttribute('data-current-source-key') || '').trim().toLowerCase();
            const pickEl = r.querySelector('select[data-field="source_pick"]');
            const pick = pickEl ? String(pickEl.value || '').trim().toLowerCase() : '';
            const labelEl = r.querySelector('input[data-field="source_label"]');
            const iconEl = r.querySelector('input[data-field="icon_url"]');
            const label = labelEl ? String(labelEl.value || '').trim() : '';
            const iconUrl = iconEl ? String(iconEl.value || '').trim() : '';
            if (!pick && !label && !iconUrl) return; // nothing entered

            const currentLabel = currentKey ? trafficSourceLabelForKey(currentKey, '') : '';
            if (pick && pick !== '__other__') {
              if (pick === currentKey) {
                if (iconUrl) {
                  jobs.push({
                    kind: 'meta',
                    tokenKey: tkey,
                    payload: { source_key: pick, label: trafficSourceLabelForKey(pick, pick), icon_url: iconUrl },
                  });
                }
                return;
              }
              jobs.push({
                kind: 'map',
                tokenKey: tkey,
                payload: { utm_param: utmParam, utm_value: utmValue, source_key: pick, source_label: '', icon_url: iconUrl || null, since_days: 30, limit_sessions: 50000 },
              });
              return;
            }

            // Other/custom label mode.
            if (!label) return; // can't map without a label

            if (currentKey && normalizeFlatLabel(currentLabel) && normalizeFlatLabel(currentLabel) === normalizeFlatLabel(label)) {
              if (iconUrl) {
                jobs.push({
                  kind: 'meta',
                  tokenKey: tkey,
                  payload: { source_key: currentKey, label: trafficSourceLabelForKey(currentKey, currentKey), icon_url: iconUrl },
                });
              }
              return;
            }

            jobs.push({
              kind: 'map',
              tokenKey: tkey,
              payload: { utm_param: utmParam, utm_value: utmValue, source_label: label, icon_url: iconUrl || null, since_days: 30, limit_sessions: 50000 },
            });
          });

          if (!jobs.length) {
            setTsmSaveMsg(rootEl, 'No pending mappings.');
            return;
          }

          // Disable action buttons while saving.
          rootEl.querySelectorAll('button[data-tsm-action]').forEach(function(b) { b.disabled = true; });
          setTsmSaveMsg(rootEl, 'Saving ' + jobs.length + '…');

          let ok = 0;
          let fail = 0;
          function run(i) {
            if (i >= jobs.length) return Promise.resolve();
            setTsmSaveMsg(rootEl, 'Saving ' + (i + 1) + '/' + jobs.length + '…');
            const j = jobs[i];
            const p = j.kind === 'meta' ? postTrafficSourceMeta(j.payload) : postTrafficSourceMap(j.payload);
            return Promise.resolve(p)
              .then(function() {
                ok += 1;
                if (j && j.tokenKey) trafficSourceTokenDrafts.delete(j.tokenKey);
              })
              .catch(function(err) {
                fail += 1;
                console.error(err);
              })
              .then(function() { return run(i + 1); });
          }

          run(0)
            .then(function() { setTsmSaveMsg(rootEl, 'Saved ' + ok + (fail ? (', failed ' + fail) : '') + '. Refreshing…'); })
            .then(function() { return refreshTrafficSourceMeta({ force: true }); })
            .then(function() { try { refreshTraffic({ force: true }); } catch (_) {} })
            .then(function() { return refreshTrafficSourceMappingPanel({ force: true, rootId: rootId }); })
            .catch(function(err) {
              console.error(err);
              setTsmSaveMsg(rootEl, 'Save failed: ' + (err && err.message ? String(err.message) : 'error'));
            })
            .finally(function() {
              // Buttons will be recreated on refresh; if refresh failed, re-enable the existing ones.
              try {
                const rr = document.getElementById(rootId);
                if (rr) rr.querySelectorAll('button[data-tsm-action]').forEach(function(b) { b.disabled = false; });
              } catch (_) {}
            });
          return;
        }
        if (action === 'map-token') {
          const row = btn.closest('.tsm-token-row');
          if (!row) return;
          const utmParam = (row.getAttribute('data-utm-param') || '').trim();
          const utmValue = (row.getAttribute('data-utm-value') || '').trim();
          const labelEl = row.querySelector('input[data-field="source_label"]');
          const iconEl = row.querySelector('input[data-field="icon_url"]');
          const sourceLabel = labelEl ? String(labelEl.value || '').trim() : '';
          const iconUrl = iconEl ? String(iconEl.value || '').trim() : '';
          if (!utmParam || !utmValue || !sourceLabel) {
            alert('Please enter a Source name.');
            return;
          }
          btn.disabled = true;
          postTrafficSourceMap({ utm_param: utmParam, utm_value: utmValue, source_label: sourceLabel, icon_url: iconUrl || null, since_days: 30, limit_sessions: 50000 })
            .then(function() { return refreshTrafficSourceMeta({ force: true }); })
            .then(function() { try { refreshTraffic({ force: true }); } catch (_) {} })
            .then(function() { return refreshTrafficSourceMappingPanel({ force: true, rootId: rootId }); })
            .finally(function() { btn.disabled = false; });
          return;
        }
        if (action === 'save-meta') {
          const row = btn.closest('.tsm-source-row');
          if (!row) return;
          const sourceKey = (row.getAttribute('data-source-key') || '').trim();
          const labelEl = row.querySelector('input[data-field="label"]');
          const iconEl = row.querySelector('input[data-field="icon_url"]');
          const label = labelEl ? String(labelEl.value || '').trim() : '';
          const iconUrl = iconEl ? String(iconEl.value || '').trim() : '';
          if (!sourceKey || !label) {
            alert('Source label is required.');
            return;
          }
          btn.disabled = true;
          postTrafficSourceMeta({ source_key: sourceKey, label: label, icon_url: iconUrl || null })
            .then(function() { return refreshTrafficSourceMeta({ force: true }); })
            .then(function() { try { renderTable(); } catch (_) {} })
            .then(function() { try { refreshTraffic({ force: true }); } catch (_) {} })
            .then(function() { return refreshTrafficSourceMappingPanel({ force: true, rootId: rootId }); })
            .finally(function() { btn.disabled = false; });
          return;
        }
      };

      // Initial load (best-effort).
      if (!root.getAttribute('data-tsm-loaded')) {
        root.setAttribute('data-tsm-loaded', '1');
        refreshTrafficSourceMappingPanel({ force: true, rootId: rootId });
      }
    }

    function sourceCell(s) {
      function icon(src, alt, title, extraClass) {
        const cls = (extraClass ? (extraClass + ' ') : '') + 'source-icon-img';
        const t = title ? ' title="' + escapeHtml(String(title)) + '"' : '';
        return '<img src="' + escapeHtml(hotImg(src) || src || '') + '" alt="' + escapeHtml(alt || '') + '" class="' + cls + '" width="20" height="20"' + t + '>';
      }

      // Show source icons driven by Traffic sources + mapping:
      // - If a session matches multiple mapping rules, show multiple icons side-by-side.
      // - Otherwise, show the derived `sessions.traffic_source_key` (includes Direct/no-referrer).
      // This avoids legacy hard-coded UTM/referrer icon heuristics and prevents duplicates.
      const keys = [];
      const seen = new Set();
      function addKey(v) {
        const k = v != null ? String(v).trim().toLowerCase() : '';
        if (!k) return;
        if (seen.has(k)) return;
        seen.add(k);
        keys.push(k);
      }

      try {
        const mapped = getMappedSourceKeysForSession(s);
        (Array.isArray(mapped) ? mapped : []).forEach(addKey);
      } catch (_) {}

      if (!keys.length) {
        // Fallback: use stored source_key (so icon/meta changes go live even when no UTM-token mapping exists).
        let k = s && (s.traffic_source_key ?? s.trafficSourceKey ?? s.source_key ?? s.sourceKey);
        const kk = k != null ? String(k).trim().toLowerCase() : '';
        if (kk === 'other') {
          const ref = s && s.referrer != null ? String(s.referrer).toLowerCase() : '';
          if (ref.includes('heybigday.com') || ref.includes('hbdjewellery.com')) k = 'direct';
        }
        addKey(k);
      }

      if (!keys.length) return '';

      const out = [];
      keys.forEach(function(key) {
        const label = trafficSourceLabelForKey(key, key);
        const metaIcon = trafficSourceIconUrlForKey(key);
        const src = metaIcon || trafficSourceBuiltInIconSrc(key) || SOURCE_UNKNOWN_IMG;
        const extra = key === 'google_ads' ? 'source-googleads-img' : '';
        out.push(icon(src, label, label, extra));
      });
      return out.length ? ('<span class="source-icons">' + out.join('') + '</span>') : '';
    }

    function sourceDetailForPanel(s) {
      const lines = [];
      const entry = s.entry_url && String(s.entry_url).trim();
      if (entry) lines.push('Entry URL (CF referer): ' + entry);
      const ref = s.referrer && String(s.referrer).trim();
      if (ref) lines.push('Referrer: ' + ref);
      if (s.utm_source != null && String(s.utm_source).trim() !== '') lines.push('utm_source: ' + String(s.utm_source).trim());
      if (s.utm_medium != null && String(s.utm_medium).trim() !== '') lines.push('utm_medium: ' + String(s.utm_medium).trim());
      if (s.utm_campaign != null && String(s.utm_campaign).trim() !== '') lines.push('utm_campaign: ' + String(s.utm_campaign).trim());
      if (s.utm_content != null && String(s.utm_content).trim() !== '') lines.push('utm_content: ' + String(s.utm_content).trim());
      if (lines.length === 0) return '—';
      return lines.join('\n');
    }

    function renderRow(s) {
      const countryCode = s.country_code || 'XX';
      const visits = (s.returning_count != null ? s.returning_count : 0) + 1;
      const visitsLabel = visits === 1 ? '1 visit' : visits + ' visits';
      const cartValueNum = s.cart_value != null ? Number(s.cart_value) : NaN;
      const cartVal = s.has_purchased ? '' : ((s.cart_value != null && !Number.isNaN(cartValueNum))
        ? formatMoney(Math.floor(cartValueNum), s.cart_currency)
        : '');
      const saleVal = s.has_purchased ? formatMoney(s.order_total != null ? Number(s.order_total) : null, s.order_currency) : '';
      const cartOrSaleCell = s.has_purchased
        ? '<span class="cart-value-sale">' + escapeHtml(saleVal) + '</span>'
        : cartVal;
      const fromCell = flagImg(countryCode);
      let consentDebug = '';
      if (s && s.meta_json) {
        try {
          const mj = JSON.parse(String(s.meta_json || '{}'));
          consentDebug = (mj && mj.customer_privacy_debug) ? 'yes' : '';
        } catch (_) {}
      }
      return `<div class="grid-row clickable ${s.is_returning ? 'returning' : ''} ${s.has_purchased ? 'converted' : ''}" role="row" data-session-id="${s.session_id}">
        <div class="grid-cell" role="cell">${landingPageCell(s)}</div>
        <div class="grid-cell flag-cell" role="cell">${fromCell}</div>
        <div class="grid-cell source-cell" role="cell">${sourceCell(s)}</div>
        <div class="grid-cell" role="cell">${escapeHtml(s.device || '')}</div>
        <div class="grid-cell cart-value-cell" role="cell">${cartOrSaleCell}</div>
        <div class="grid-cell arrived-cell" role="cell"><span data-started="${s.started_at}">${arrivedAgo(s.started_at)}</span></div>
        <div class="grid-cell last-seen-cell" role="cell"><span data-last-seen="${s.last_seen}">${arrivedAgo(s.last_seen)}</span></div>
        <div class="grid-cell" role="cell">${visitsLabel}</div>
        <div class="grid-cell consent-debug consent-col is-hidden" role="cell">${escapeHtml(consentDebug)}</div>
      </div>`;
    }

    function escapeHtml(str) {
      if (str == null) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function cartSortValue(s) {
      if (s.has_purchased && s.order_total != null) return Number(s.order_total);
      if (s.cart_value != null) { const n = Number(s.cart_value); if (!Number.isNaN(n)) return n; }
      return -Infinity;
    }

    function getSortedSessions() {
      if (!sortBy) return sessions.slice();
      const list = sessions.slice();
      const mult = sortDir === 'asc' ? 1 : -1;
      list.sort(function (a, b) {
        var va, vb;
        if (sortBy === 'landing') {
          va = (landingSortKey(a) || '').toLowerCase();
          vb = (landingSortKey(b) || '').toLowerCase();
          return mult * (va < vb ? -1 : va > vb ? 1 : 0);
        }
        if (sortBy === 'from') {
          va = (a.country_code || 'ZZ').toUpperCase();
          vb = (b.country_code || 'ZZ').toUpperCase();
          return mult * (va < vb ? -1 : va > vb ? 1 : 0);
        }
        if (sortBy === 'arrived') {
          va = toMs(a.started_at) ?? 0;
          vb = toMs(b.started_at) ?? 0;
          return mult * (va - vb);
        }
        if (sortBy === 'source') {
          va = sourceSortKey(a);
          vb = sourceSortKey(b);
          return mult * (va < vb ? -1 : va > vb ? 1 : 0);
        }
        if (sortBy === 'device') {
          va = (a && a.device != null ? String(a.device) : '').trim().toLowerCase();
          vb = (b && b.device != null ? String(b.device) : '').trim().toLowerCase();
          return mult * (va < vb ? -1 : va > vb ? 1 : 0);
        }
        if (sortBy === 'cart') {
          va = cartSortValue(a);
          vb = cartSortValue(b);
          return mult * (va - vb);
        }
        if (sortBy === 'last_seen') {
          va = toMs(a.last_seen) ?? 0;
          vb = toMs(b.last_seen) ?? 0;
          return mult * (va - vb);
        }
        if (sortBy === 'history') {
          va = visitsCount(a);
          vb = visitsCount(b);
          return mult * (va - vb);
        }
        return 0;
      });
      return list;
    }

    function renderTable() {
      const tbody = document.getElementById('table-body');
      const isRangeMode = sessionsTotal != null;
      const totalPages = isRangeMode
        ? Math.max(1, Math.ceil(sessionsTotal / rowsPerPage))
        : Math.max(1, Math.ceil(getSortedSessions().length / rowsPerPage));
      currentPage = Math.min(Math.max(1, currentPage), totalPages);
      const start = (currentPage - 1) * rowsPerPage;
      const sorted = getSortedSessions();
      const pageSessions = isRangeMode ? sorted : sorted.slice(start, start + rowsPerPage);
      if (pageSessions.length === 0) {
        var emptyMsg = sessionsLoadError ? sessionsLoadError : 'No sessions in this view.';
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml(emptyMsg) + '</div></div>';
      } else {
        tbody.innerHTML = pageSessions.map(renderRow).join('');
        document.querySelectorAll('#table-body .grid-row.clickable').forEach(tr => {
          tr.addEventListener('click', () => {
            selectedSessionId = tr.dataset.sessionId;
            openSidePanel(selectedSessionId);
          });
        });
      }
      var paginWrap = document.getElementById('table-pagination');
      if (paginWrap) {
        paginWrap.classList.toggle('is-hidden', totalPages <= 1);
        if (totalPages > 1) paginWrap.innerHTML = buildPaginationHtml(currentPage, totalPages);
      }
      const rowsSelect = document.getElementById('rows-per-page-select');
      if (rowsSelect) rowsSelect.value = String(rowsPerPage);
      updateSortHeaders();
      syncSessionsTableTightMode();
      tickTimeOnSite();
    }

    function syncSessionsTableTightMode() {
      const wrap = document.querySelector('.table-scroll-wrap');
      const table = document.getElementById('sessions-table');
      if (!wrap || !table) return;
      // "Max mode": when all columns fit, remove extra inter-column padding.
      const fits = table.scrollWidth <= wrap.clientWidth + 1;
      wrap.classList.toggle('tight-cols', !!fits);
    }

    function updateSortHeaders() {
      document.querySelectorAll('.table-scroll-wrap .grid-cell.sortable').forEach(function (th) {
        var col = th.getAttribute('data-sort');
        th.classList.remove('th-sort-asc', 'th-sort-desc');
        th.setAttribute('aria-sort', sortBy === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        if (sortBy === col) th.classList.add(sortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
      });
    }

    function setupSortableHeaders() {
      document.querySelectorAll('.table-scroll-wrap .grid-cell.sortable').forEach(function (th) {
        function activate() {
          var col = (th.getAttribute('data-sort') || '').trim();
          if (!col) return;
          if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          else { sortBy = col; sortDir = SORT_DEFAULTS[col] || 'asc'; }
          renderTable();
        }
        th.addEventListener('click', function (e) {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          activate();
        });
        th.addEventListener('keydown', function (e) {
          if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          activate();
        });
      });
    }

    function tickTimeOnSite() {
      document.querySelectorAll('#table-body span[data-started]').forEach(span => {
        const started = parseInt(span.getAttribute('data-started'), 10);
        span.textContent = arrivedAgo(started);
      });
      document.querySelectorAll('#table-body span[data-last-seen]').forEach(span => {
        const lastSeen = parseInt(span.getAttribute('data-last-seen'), 10);
        span.textContent = arrivedAgo(lastSeen);
      });
    }

    function pct(v) { return v != null ? v.toFixed(1) + '%' : ''; }

    function crPillHtml(v) {
      const n = v != null ? Number(v) : NaN;
      if (!Number.isFinite(n)) return '';
      return '<span class="aov-card-cr-pill" title="Conversion rate">CR ' + escapeHtml(pct(n)) + '</span>';
    }

    function formatRevenue(num) {
      if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return '';
      // Keep dashboard currency formatting consistent everywhere (thousands separators + 2dp).
      try {
        return '\u00A3' + num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } catch (_) {
        return '\u00A3' + num.toFixed(2);
      }
    }

    function formatRevenueSub(num) {
      if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return '\u2014';
      return formatRevenue(num) || '\u2014';
    }

    function isIconMode() {
      try {
        return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
      } catch (_) {
        return false;
      }
    }

    function formatRevenueTableHtml(num) {
      if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return '—';
      if (isIconMode()) return '\u00A3' + Math.round(num).toLocaleString('en-GB');
      if (num % 1 === 0) return '\u00A3' + num.toLocaleString('en-GB');
      let fixed = null;
      try {
        fixed = num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } catch (_) {
        fixed = num.toFixed(2);
      }
      const parts = String(fixed).split('.');
      return '\u00A3' + parts[0] + '<span class="rev-decimal">.' + (parts[1] || '00') + '</span>';
    }

    function animateTickerText(el, nextText) {
      if (!el) return;
      const prev = el.textContent != null ? String(el.textContent) : '';
      const next = nextText != null ? String(nextText) : '';
      if (prev === next) {
        el.textContent = next;
        return;
      }
      const wrap = document.createElement('span');
      wrap.className = 'kpi-ticker';
      const stack = document.createElement('span');
      stack.className = 'kpi-ticker-stack';
      const a = document.createElement('span');
      a.className = 'kpi-ticker-line';
      a.textContent = prev;
      const b = document.createElement('span');
      b.className = 'kpi-ticker-line';
      b.textContent = next;
      stack.appendChild(a);
      stack.appendChild(b);
      wrap.appendChild(stack);
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(wrap);
      requestAnimationFrame(function() { wrap.classList.add('run'); });
      setTimeout(function() {
        // Finalize (but only if the wrapper is still present).
        if (el && el.contains(wrap)) el.textContent = next;
      }, 460);
    }

    function animateOdometerText(el, nextText) {
      if (!el) return;
      const next = nextText != null ? String(nextText) : '';
      const prevStored = el.getAttribute('data-odometer');
      const prev = prevStored != null ? String(prevStored) : (el.textContent != null ? String(el.textContent) : '');
      if (prev === next) {
        el.textContent = next;
        el.setAttribute('data-odometer', next);
        return;
      }
      const wrap = document.createElement('span');
      wrap.className = 'kpi-odometer';
      const stacks = [];
      for (let i = 0; i < next.length; i++) {
        const ch = next[i];
        if (ch >= '0' && ch <= '9') {
          const prevCh = prev[i] || '0';
          const prevDigit = (prevCh >= '0' && prevCh <= '9') ? parseInt(prevCh, 10) : 0;
          const digit = parseInt(ch, 10);
          const digitWrap = document.createElement('span');
          digitWrap.className = 'kpi-odometer-digit';
          const stack = document.createElement('span');
          stack.className = 'kpi-odometer-stack';
          for (let d = 0; d <= 9; d++) {
            const line = document.createElement('span');
            line.textContent = String(d);
            stack.appendChild(line);
          }
          stack.style.transform = 'translateY(' + (-prevDigit) + 'em)';
          digitWrap.appendChild(stack);
          wrap.appendChild(digitWrap);
          stacks.push({ stack, digit });
        } else {
          const span = document.createElement('span');
          span.className = 'kpi-odometer-char';
          span.textContent = ch;
          wrap.appendChild(span);
        }
      }
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(wrap);
      el.setAttribute('data-odometer', next);
      requestAnimationFrame(function() {
        stacks.forEach(function(item) {
          item.stack.style.transform = 'translateY(' + (-item.digit) + 'em)';
        });
      });
      setTimeout(function() {
        if (!el || !el.contains(wrap)) return;
        el.textContent = next;
      }, 460);
    }

    function productUrlFromHandle(handle) {
      const h = handle != null ? String(handle).trim() : '';
      if (!h) return '';
      const base = getMainBaseUrl();
      if (!base) return '';
      return base + '/products/' + encodeURIComponent(h.replace(/^\/+/, ''));
    }

    function resolveSaleToastThumbSrc(data) {
      if (!data) return '';
      const rawThumb = data.productThumbUrl != null ? String(data.productThumbUrl).trim() : '';
      if (rawThumb) return hotImgSquare(rawThumb) || rawThumb;
      const directUrl = data.productUrl != null ? String(data.productUrl).trim() : '';
      const handleUrl = data.productHandle ? productUrlFromHandle(data.productHandle) : '';
      const finalUrl = directUrl || handleUrl;
      if (!finalUrl) return '';
      return (API || '') + '/api/og-thumb?url=' + encodeURIComponent(finalUrl) + '&width=100';
    }

    function setSaleToastContent(patch) {
      patch = patch && typeof patch === 'object' ? patch : {};
      const data = { ...(saleToastLastPayload || {}) };
      const hasOwn = Object.prototype.hasOwnProperty;
      if (hasOwn.call(patch, 'countryCode')) data.countryCode = patch.countryCode;
      if (hasOwn.call(patch, 'productTitle')) data.productTitle = patch.productTitle;
      if (hasOwn.call(patch, 'amountGbp')) data.amountGbp = patch.amountGbp;
      if (hasOwn.call(patch, 'productHandle')) data.productHandle = patch.productHandle;
      if (hasOwn.call(patch, 'productUrl')) data.productUrl = patch.productUrl;
      if (hasOwn.call(patch, 'productThumbUrl')) data.productThumbUrl = patch.productThumbUrl;
      if (hasOwn.call(patch, 'createdAt')) data.createdAt = patch.createdAt;

      const cc = (data.countryCode || 'XX').toString().trim().toUpperCase().slice(0, 2) || 'XX';
      const product = data.productTitle != null ? String(data.productTitle) : '';
      const amountRaw = data.amountGbp != null ? Number(data.amountGbp) : null;
      const amountGbp = (amountRaw != null && Number.isFinite(amountRaw)) ? amountRaw : null;
      const thumbSrc = resolveSaleToastThumbSrc(data);
      const timeText = formatSaleTime(data.createdAt);

      saleToastLastPayload = {
        ...data,
        countryCode: cc,
        productTitle: product,
        amountGbp: amountGbp,
      };

      const inlineFlagEl = document.getElementById('sale-toast-inline-flag');
      const titleEl = document.getElementById('sale-toast-title');
      const productEl = document.getElementById('sale-toast-product');
      const amountEl = document.getElementById('sale-toast-amount');
      const thumbEl = document.getElementById('sale-toast-thumb');
      const timeEl = document.getElementById('sale-toast-time');
      const titleText = (cc && cc !== 'XX') ? countryLabelFull(cc) : 'Unknown';
      if (inlineFlagEl) inlineFlagEl.innerHTML = flagImgSmall(cc);
      if (titleEl) titleEl.textContent = titleText || 'Unknown';
      if (productEl) productEl.textContent = product && product.trim() ? product : '\u2014';
      if (amountEl) amountEl.textContent = (amountGbp != null) ? (formatRevenue(amountGbp) || '\u00A3\u2014') : '\u00A3\u2014';
      if (thumbEl) {
        thumbEl.innerHTML = thumbSrc
          ? '<img src="' + escapeHtml(thumbSrc) + '" alt="" loading="lazy" onerror="this.classList.add(\'is-hidden\')">'
          : '<span class="sale-toast-thumb-placeholder" aria-hidden="true"></span>';
      }
      if (timeEl) timeEl.textContent = timeText;
      if (data.createdAt != null) {
        try { setLastSaleAt(data.createdAt); } catch (_) {}
      }
    }

    function updateSaleToastToggle() {
      var isPinned = !!saleToastPinned;
      ['last-sale-toggle', 'footer-last-sale-toggle'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.toggle('is-on', isPinned);
        btn.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
        btn.setAttribute('aria-label', isPinned ? 'Hide last sale toast' : 'Show last sale toast');
        var eyeOn = btn.querySelector('.ti-eye');
        var eyeOff = btn.querySelector('.ti-eye-off');
        if (eyeOn) eyeOn.style.display = isPinned ? 'none' : '';
        if (eyeOff) eyeOff.style.display = isPinned ? '' : 'none';
      });
    }

    function showSaleToast() {
      const overlay = document.getElementById('sale-toast-overlay');
      const toast = document.getElementById('sale-toast');
      if (!overlay || !toast) return;
      saleToastActive = true;
      saleToastLastShownAt = Date.now();
      toast.classList.remove('settled');
      overlay.setAttribute('aria-hidden', 'false');
      toast.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(function() { toast.classList.add('active'); });
    }

    function hideSaleToast() {
      const overlay = document.getElementById('sale-toast-overlay');
      const toast = document.getElementById('sale-toast');
      if (saleToastHideTimer) {
        clearTimeout(saleToastHideTimer);
        saleToastHideTimer = null;
      }
      if (!overlay || !toast) {
        saleToastActive = false;
        saleToastSessionId = null;
        return;
      }
      toast.classList.remove('settled');
      toast.classList.remove('active');
      toast.setAttribute('aria-hidden', 'true');
      overlay.setAttribute('aria-hidden', 'true');
      setTimeout(function() {
        saleToastActive = false;
        saleToastSessionId = null;
      }, 320);
    }

    (function initSaleToastTextCrispFix() {
      const toast = document.getElementById('sale-toast');
      if (!toast || !toast.addEventListener) return;
      toast.addEventListener('transitionend', function(e) {
        // When the toast finishes sliding in, drop the transform layer so text stays crisp.
        if (!toast.classList.contains('active')) return;
        if (e && e.propertyName && e.propertyName !== 'transform') return;
        toast.classList.add('settled');
      });
    })();

    let latestSaleFetchInFlight = null;
    function fetchLatestSaleForToast(options = {}) {
      const forceNew = !!(options && options.forceNew);
      if (!forceNew && latestSaleFetchInFlight) return latestSaleFetchInFlight;
      const url = API + '/api/latest-sale?_=' + Date.now();
      const p = fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(json) { return (json && json.ok && json.sale) ? json.sale : null; })
        .catch(function() { return null; })
        .finally(function() { if (latestSaleFetchInFlight === p) latestSaleFetchInFlight = null; });
      latestSaleFetchInFlight = p;
      return p;
    }

    function buildSalesKpiUpdateFromStats(data) {
      const rangeKey = getStatsRange();
      const sales = data && data.sales ? data.sales : {};
      const convertedCountMap = data && data.convertedCount ? data.convertedCount : {};
      const salesVal = typeof sales[rangeKey] === 'number' ? sales[rangeKey] : null;
      const orderCountVal = typeof convertedCountMap[rangeKey] === 'number' ? convertedCountMap[rangeKey] : null;
      return {
        labelText: orderCountVal != null ? (orderCountVal + ' Orders') : 'Orders',
        valueText: salesVal != null ? (formatRevenue(salesVal) || '\u2014') : '\u2014',
      };
    }

    // Sale sound: prime/unlock on first user interaction, and retry once on click if autoplay is blocked.
    function primeSaleAudio() {
      if (!saleAudio || saleAudioPrimed) return;
      const a = saleAudio;
      saleAudioPrimed = true;
      const prevMuted = !!a.muted;
      const prevVol = (typeof a.volume === 'number' && Number.isFinite(a.volume)) ? a.volume : 1;
      try { a.preload = 'auto'; } catch (_) {}
      try { a.load(); } catch (_) {}
      try { a.muted = true; } catch (_) {}
      try { a.volume = 0; } catch (_) {}
      try {
        const p = a.play();
        if (p && typeof p.then === 'function') {
          p.then(function() {
            try { a.pause(); } catch (_) {}
            try { a.currentTime = 0; } catch (_) {}
          }).catch(function() {
            saleAudioPrimed = false;
          }).finally(function() {
            try { a.pause(); } catch (_) {}
            try { a.currentTime = 0; } catch (_) {}
            try { a.muted = prevMuted; } catch (_) {}
            try { a.volume = prevVol; } catch (_) {}
          });
          return;
        }
      } catch (_) {
        saleAudioPrimed = false;
      }
      try { a.pause(); } catch (_) {}
      try { a.currentTime = 0; } catch (_) {}
      try { a.muted = prevMuted; } catch (_) {}
      try { a.volume = prevVol; } catch (_) {}
    }

    function playSaleSound(options = {}) {
      const deferOnClick = options.deferOnClick !== false;
      if (saleMuted || !saleAudio) return;
      try { saleAudio.currentTime = 0; } catch (_) {}
      const p = saleAudio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function() {
          if (!deferOnClick) return;
          if (saleSoundDeferredOnce) return;
          saleSoundDeferredOnce = true;
          document.addEventListener('click', function once() {
            saleSoundDeferredOnce = false;
            if (saleMuted || !saleAudio) return;
            try { saleAudio.currentTime = 0; } catch (_) {}
            saleAudio.play().catch(function() {});
          }, { once: true });
        });
      }
    }

    function triggerSaleToast(opts) {
      opts = opts && typeof opts === 'object' ? opts : {};
      const session = opts.session || null;
      const playSound = opts.playSound !== false;
      const payload = opts.payload || null;
      const skipLatest = !!opts.skipLatest;
      const persist = !!opts.persist;
      const toastToken = ++saleToastToken; // newest toast wins
      saleToastLastPayload = null;
      saleToastSessionId = session && session.session_id != null ? String(session.session_id) : null;
      saleToastLastOrderId = null;
      if (persist) {
        saleToastPinned = true;
        updateSaleToastToggle();
      } else if (saleToastPinned) {
        saleToastPinned = false;
        updateSaleToastToggle();
      }

      showSaleToast();

      if (payload) {
        setSaleToastContent(payload);
      } else {
        // Fast, best-effort content from the session update (then refined by truth).
        try {
          const cc = session && session.country_code ? String(session.country_code).toUpperCase().slice(0, 2) : 'XX';
          let productTitle = '';
          let productHandle = '';
          if (session && session.last_product_handle) productHandle = String(session.last_product_handle).trim();
          if (!productHandle && session && session.first_product_handle) productHandle = String(session.first_product_handle).trim();
          if (productHandle) productTitle = titleCaseFromHandle(String(productHandle));
          let amountGbp = null;
          if (session && session.order_total != null) {
            const n = typeof session.order_total === 'number' ? session.order_total : parseFloat(String(session.order_total));
            if (Number.isFinite(n)) amountGbp = n;
          }
          const createdAt = (session && session.purchased_at != null)
            ? session.purchased_at
            : (session && session.last_seen != null)
              ? session.last_seen
              : (session && session.started_at != null)
                ? session.started_at
                : Date.now();
          setSaleToastContent({
            countryCode: cc,
            productTitle: productTitle || 'Processing\u2026',
            amountGbp,
            productHandle: productHandle || '',
            createdAt,
          });
        } catch (_) {}
      }

      if (playSound) playSaleSound({ deferOnClick: true });

      if (saleToastHideTimer) clearTimeout(saleToastHideTimer);
      if (!persist) saleToastHideTimer = setTimeout(hideSaleToast, 10000);

      if (skipLatest) return;
      fetchLatestSaleForToast({ forceNew: true }).then(function(sale) {
        if (!sale) return;
        if (toastToken !== saleToastToken) return; // stale fetch (a newer sale toast is showing)
        if (!saleToastActive) return;
        const orderId = sale.orderId != null ? String(sale.orderId) : '';
        if (orderId) saleToastLastOrderId = orderId;
        const cc = sale.countryCode ? String(sale.countryCode).toUpperCase().slice(0, 2) : 'XX';
        const product = sale.productTitle && String(sale.productTitle).trim() ? String(sale.productTitle).trim() : '';
        const amount = sale.amountGbp != null ? Number(sale.amountGbp) : null;
        const productHandle = sale.productHandle != null ? String(sale.productHandle).trim() : '';
        const productThumbUrl = sale.productThumbUrl != null ? String(sale.productThumbUrl).trim() : '';
        const createdAt = sale.createdAt != null ? sale.createdAt : null;
        setSaleToastContent({
          countryCode: cc || 'XX',
          productTitle: product || (document.getElementById('sale-toast-product') ? document.getElementById('sale-toast-product').textContent : '—'),
          amountGbp: (amount != null && Number.isFinite(amount)) ? amount : null,
          productHandle: productHandle || '',
          productThumbUrl: productThumbUrl || '',
          createdAt,
        });
      });
    }

    function buildSaleToastPayloadFromSale(sale) {
      if (!sale) return null;
      const cc = sale.countryCode ? String(sale.countryCode).toUpperCase().slice(0, 2) : 'XX';
      const productTitle = sale.productTitle && String(sale.productTitle).trim() ? String(sale.productTitle).trim() : '';
      const amount = sale.amountGbp != null ? Number(sale.amountGbp) : null;
      return {
        countryCode: cc || 'XX',
        productTitle,
        amountGbp: (amount != null && Number.isFinite(amount)) ? amount : null,
        productHandle: sale.productHandle != null ? String(sale.productHandle).trim() : '',
        productThumbUrl: sale.productThumbUrl != null ? String(sale.productThumbUrl).trim() : '',
        createdAt: sale.createdAt != null ? sale.createdAt : null,
      };
    }

    function triggerManualSaleToast(persist) {
      const keep = !!persist;
      const cached = saleToastLastPayload;
      const cachedAt = cached && cached.createdAt != null ? toMs(cached.createdAt) : null;
      const latestAt = toMs(lastSaleAt);
      const cacheIsFresh = cachedAt != null && latestAt != null && Math.abs(cachedAt - latestAt) < 1000;
      if (cached && (cached.productTitle || cached.amountGbp != null || cached.productHandle || cached.productThumbUrl) && cacheIsFresh) {
        triggerSaleToast({ origin: 'manual', payload: cached, playSound: false, skipLatest: true, persist: keep });
        return;
      }
      fetchLatestSaleForToast({ forceNew: true }).then(function(sale) {
        const payload = buildSaleToastPayloadFromSale(sale);
        if (!payload) return;
        triggerSaleToast({ origin: 'manual', payload: payload, playSound: false, skipLatest: true, persist: keep });
      });
    }

    (function initSaleToastToggle() {
      function handleToggle(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (saleToastPinned) {
          saleToastPinned = false;
          updateSaleToastToggle();
          hideSaleToast();
        } else {
          triggerManualSaleToast(true);
        }
      }
      ['last-sale-toggle', 'footer-last-sale-toggle'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', handleToggle);
      });
      updateSaleToastToggle();
    })();

    (function initSaleToastCloseBtn() {
      var btn = document.getElementById('sale-toast-close');
      if (!btn) return;
      btn.addEventListener('click', function(e) {
        if (e) e.preventDefault();
        saleToastPinned = false;
        updateSaleToastToggle();
        hideSaleToast();
      });
    })();

    function getShopParam() {
      var p = new URLSearchParams(window.location.search);
      var shop = p.get('shop') || '';
      return shop && /\.myshopify\.com$/i.test(shop) ? shop : null;
    }

    function fetchShopifySales() {
      var shop = getShopForSales();
      if (!shop || getStatsRange() !== 'today') {
        // If the store-base-url lookup is done and we still have no shop, stop waiting and fall back to DB.
        if (getStatsRange() === 'today' && storeBaseUrlLoaded && !shop) shopifySalesTodayLoaded = true;
        shopifySalesTodayLoading = false;
        return;
      }
      if (shopifySalesTodayLoading) return;
      shopifySalesTodayLoading = true;
      fetch(API + '/api/shopify-sales?shop=' + encodeURIComponent(shop), { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          shopifySalesToday = data && typeof data.salesToday === 'number' ? data.salesToday : null;
          shopifyOrderCountToday = data && typeof data.orderCountToday === 'number' ? data.orderCountToday : null;
          shopifySalesTodayLoaded = true;
          shopifySalesTodayLoading = false;
          renderSales(statsCache);
          renderLiveKpis(getKpiData());
        })
        .catch(function() {
          shopifySalesToday = null;
          shopifyOrderCountToday = null;
          shopifySalesTodayLoaded = true;
          shopifySalesTodayLoading = false;
          renderSales(statsCache);
          renderLiveKpis(getKpiData());
        });
    }

    function fetchShopifySessions() {
      var shop = getShopForSales();
      if (!shop || getStatsRange() !== 'today') {
        if (getStatsRange() === 'today' && storeBaseUrlLoaded && !shop) shopifySessionsTodayLoaded = true;
        shopifySessionsTodayLoading = false;
        return;
      }
      if (shopifySessionsTodayLoading) return;
      shopifySessionsTodayLoading = true;
      fetch(API + '/api/shopify-sessions?shop=' + encodeURIComponent(shop), { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          shopifySessionsToday = data && typeof data.sessionsToday === 'number' ? data.sessionsToday : null;
          shopifySessionsTodayLoaded = true;
          shopifySessionsTodayLoading = false;
          renderLiveKpis(getKpiData());
        })
        .catch(function() {
          shopifySessionsToday = null;
          shopifySessionsTodayLoaded = true;
          shopifySessionsTodayLoading = false;
          renderLiveKpis(getKpiData());
        });
    }

    function fetchBestSellers(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        bestSellersCache = null;
        renderBestSellers(null);
        return Promise.resolve(null);
      }
      let url = API + '/api/shopify-best-sellers?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange()) +
          '&page=' + encodeURIComponent(String(bestSellersPage || 1)) +
          '&pageSize=' + encodeURIComponent(String(TOP_TABLE_PAGE_SIZE)) +
          '&sort=' + encodeURIComponent(String(bestSellersSortBy || 'rev')) +
          '&dir=' + encodeURIComponent(String(bestSellersSortDir || 'desc'));
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, status: r.status, data: data || {} }; }).catch(function() { return { ok: r.ok, status: r.status, data: {} }; }); })
        .then(function(result) {
          if (result.ok) {
            bestSellersCache = result.data;
            renderProductsChart(result.data);
            renderBestSellers(result.data);
            return result.data;
          }
          var msg = (result.data && result.data.error) ? result.data.error : ('Error ' + result.status);
          if (result.data && result.data.hint) msg += '. ' + result.data.hint;
          bestSellersCache = null;
          renderBestSellers(null, msg);
          return null;
        })
        .catch(function() { bestSellersCache = null; renderBestSellers(null); return null; });
    }

    function normalizeProductsLeaderboardView(v) {
      const s = v != null ? String(v).trim().toLowerCase() : '';
      return s === 'type' ? 'type' : 'title';
    }

    function labelForProductsLeaderboardView(view) {
      return normalizeProductsLeaderboardView(view) === 'type' ? 'Product Type' : 'Product Title';
    }

    function updateProductsLeaderboardDropdownUi() {
      const view = normalizeProductsLeaderboardView(productsLeaderboardView);
      const labelEl = document.getElementById('products-leaderboard-label');
      const grid = document.getElementById('leaderboard-cards-grid');
      const wrap = document.getElementById('leaderboard-cards-wrap');
      const menu = document.getElementById('products-leaderboard-menu');
      if (labelEl) labelEl.textContent = labelForProductsLeaderboardView(view);
      if (grid) grid.setAttribute('data-leaderboard-view', view);
      if (wrap) wrap.setAttribute('data-leaderboard-view', view);
      if (menu) {
        const opts = menu.querySelectorAll('.aov-cards-title-option');
        opts.forEach(function(el) {
          const v = normalizeProductsLeaderboardView(el && el.getAttribute ? el.getAttribute('data-view') : '');
          el.setAttribute('aria-current', v === view ? 'true' : 'false');
        });
      }
    }

    function closeProductsLeaderboardMenu() {
      const btn = document.getElementById('products-leaderboard-btn');
      const menu = document.getElementById('products-leaderboard-menu');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (menu) {
        menu.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
      }
    }

    function toggleProductsLeaderboardMenu() {
      const btn = document.getElementById('products-leaderboard-btn');
      const menu = document.getElementById('products-leaderboard-menu');
      if (!btn || !menu) return;
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (open) {
        closeProductsLeaderboardMenu();
      } else {
        btn.setAttribute('aria-expanded', 'true');
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');
      }
    }

    function setProductsLeaderboardView(nextView, options = {}) {
      const force = !!(options && options.force);
      const view = normalizeProductsLeaderboardView(nextView);
      productsLeaderboardView = view;
      try { sessionStorage.setItem(PRODUCTS_LEADERBOARD_VIEW_KEY, view); } catch (_) {}
      updateProductsLeaderboardDropdownUi();
      closeProductsLeaderboardMenu();
      renderProductsLeaderboard(leaderboardCache);
      if (activeMainTab !== 'breakdown' && activeMainTab !== 'products') return;
      fetchProductsLeaderboard({ force }).catch(function() {});
    }

    (function initProductsLeaderboardDropdown() {
      updateProductsLeaderboardDropdownUi();
      const btn = document.getElementById('products-leaderboard-btn');
      const menu = document.getElementById('products-leaderboard-menu');
      const root = document.getElementById('products-leaderboard-dropdown');
      if (!btn || !menu || !root) return;
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleProductsLeaderboardMenu();
      });
      menu.addEventListener('click', function(e) {
        const t = e && e.target ? e.target : null;
        const opt = t && t.closest ? t.closest('.aov-cards-title-option') : null;
        if (!opt) return;
        e.preventDefault();
        e.stopPropagation();
        setProductsLeaderboardView(opt.getAttribute('data-view') || '', { force: false });
      });
      document.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        if (target && root.contains && root.contains(target)) return;
        closeProductsLeaderboardMenu();
      });
      document.addEventListener('keydown', function(e) {
        if (!e || e.key !== 'Escape') return;
        closeProductsLeaderboardMenu();
      });
    })();

    function normalizeProductsVariantCardsView(v) {
      const s = v != null ? String(v).trim().toLowerCase() : '';
      if (s === 'lengths' || s === 'length') return 'lengths';
      return 'finishes';
    }

    function labelForProductsVariantCardsView(view) {
      return normalizeProductsVariantCardsView(view) === 'lengths' ? 'Variant Length' : 'Variant Finish';
    }

    function updateProductsVariantCardsDropdownUi() {
      const view = normalizeProductsVariantCardsView(productsVariantCardsView);
      const labelEl = document.getElementById('products-variant-cards-label');
      const grid = document.getElementById('finishes-cards-grid');
      const wrap = document.getElementById('finishes-cards-wrap');
      const menu = document.getElementById('products-variant-cards-menu');
      if (labelEl) labelEl.textContent = labelForProductsVariantCardsView(view);
      if (grid) grid.setAttribute('data-cards-view', view);
      if (wrap) wrap.setAttribute('data-cards-view', view);
      if (menu) {
        const opts = menu.querySelectorAll('.aov-cards-title-option');
        opts.forEach(function(el) {
          const v = normalizeProductsVariantCardsView(el && el.getAttribute ? el.getAttribute('data-view') : '');
          el.setAttribute('aria-current', v === view ? 'true' : 'false');
        });
      }
    }

    function closeProductsVariantCardsMenu() {
      const btn = document.getElementById('products-variant-cards-btn');
      const menu = document.getElementById('products-variant-cards-menu');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (menu) {
        menu.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
      }
    }

    function toggleProductsVariantCardsMenu() {
      const btn = document.getElementById('products-variant-cards-btn');
      const menu = document.getElementById('products-variant-cards-menu');
      if (!btn || !menu) return;
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (open) {
        closeProductsVariantCardsMenu();
      } else {
        btn.setAttribute('aria-expanded', 'true');
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');
      }
    }

    function setProductsVariantCardsView(nextView, options = {}) {
      const force = !!(options && options.force);
      const view = normalizeProductsVariantCardsView(nextView);
      productsVariantCardsView = view;
      try { sessionStorage.setItem(PRODUCTS_VARIANT_CARDS_VIEW_KEY, view); } catch (_) {}
      updateProductsVariantCardsDropdownUi();
      closeProductsVariantCardsMenu();
      if (activeMainTab !== 'breakdown' && activeMainTab !== 'products') return;
      if (view === 'lengths') {
        if (lengthsCache) renderLengths(lengthsCache);
        fetchLengths({ force }).catch(function() {});
      } else {
        if (finishesCache) renderFinishes(finishesCache);
        fetchFinishes({ force }).catch(function() {});
      }
    }

    (function initProductsVariantCardsDropdown() {
      updateProductsVariantCardsDropdownUi();
      const btn = document.getElementById('products-variant-cards-btn');
      const menu = document.getElementById('products-variant-cards-menu');
      const root = document.getElementById('products-variant-cards-dropdown');
      if (!btn || !menu || !root) return;
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleProductsVariantCardsMenu();
      });
      menu.addEventListener('click', function(e) {
        const t = e && e.target ? e.target : null;
        const opt = t && t.closest ? t.closest('.aov-cards-title-option') : null;
        if (!opt) return;
        e.preventDefault();
        e.stopPropagation();
        setProductsVariantCardsView(opt.getAttribute('data-view') || '', { force: false });
      });
      document.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        if (target && root.contains && root.contains(target)) return;
        closeProductsVariantCardsMenu();
      });
      document.addEventListener('keydown', function(e) {
        if (!e || e.key !== 'Escape') return;
        closeProductsVariantCardsMenu();
      });
    })();

    function fetchProductsLeaderboard(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        leaderboardLoading = false;
        leaderboardCache = null;
        renderProductsLeaderboard(null);
        return Promise.resolve(null);
      }
      leaderboardLoading = true;
      if (!leaderboardCache) renderProductsLeaderboard(null);
      let url = API + '/api/shopify-leaderboard?shop=' + encodeURIComponent(shop) +
        '&topProducts=' + encodeURIComponent(String(PRODUCTS_LEADERBOARD_FETCH_LIMIT)) +
        '&topTypes=' + encodeURIComponent(String(PRODUCTS_LEADERBOARD_FETCH_LIMIT)) +
        '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          leaderboardCache = data;
          leaderboardLoading = false;
          renderProductsLeaderboard(data);
          renderAllTypeTables(data);
          return data;
        })
        .catch(function() { leaderboardCache = null; leaderboardLoading = false; renderProductsLeaderboard(null); renderAllTypeTables(null); return null; })
        .finally(function() { leaderboardLoading = false; });
    }

    function productsLeaderboardIsMobile() {
      return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    }

    function productsLeaderboardIsMedium() {
      return !!(window.matchMedia && window.matchMedia('(max-width: 980px)').matches);
    }

    function productsLeaderboardColumnsForView(view) {
      const v = normalizeProductsLeaderboardView(view);
      const isMobile = productsLeaderboardIsMobile();
      const isMedium = !isMobile && productsLeaderboardIsMedium();
      if (v === 'type') {
        if (isMobile) return 1;
        if (isMedium) return 2;
        return 4;
      }
      // v === 'title'
      if (isMobile) return 2;
      if (isMedium) return 4;
      return 6;
    }

    function productsLeaderboardMaxItems() {
      return productsLeaderboardIsMobile() ? 4 : 12;
    }

    function sliceProductsLeaderboardEven(list, view) {
      const arr = Array.isArray(list) ? list : [];
      const cols = productsLeaderboardColumnsForView(view);
      const max = productsLeaderboardMaxItems();
      const target = Math.min(arr.length, max);
      if (target <= 0) return [];
      if (cols <= 1 || target < cols) return arr.slice(0, target);
      const even = target - (target % cols);
      return arr.slice(0, even || target);
    }

    function renderProductsLeaderboard(data) {
      const view = normalizeProductsLeaderboardView(productsLeaderboardView);
      const grid = document.getElementById('leaderboard-cards-grid');
      if (!grid) return;
      grid.setAttribute('data-leaderboard-view', view);

      const hasData = !!(data && data.ok);
      const listAll = hasData ? (view === 'type' ? (data.byType || []) : (data.byTitle || [])) : [];
      const list = sliceProductsLeaderboardEven(listAll, view);

      if (!hasData || !listAll.length) {
        if (leaderboardLoading) {
          grid.innerHTML = '<div class="aov-card aov-card-empty aov-card--leaderboard-loading"><span class="inline-spinner" aria-hidden="true"></span><span>Building leaderboards...</span></div>';
        } else {
          grid.innerHTML = '<div class="aov-card aov-card-empty">No data</div>';
        }
        return;
      }

      if (view === 'type') {
        grid.innerHTML = list.map(function(row) {
          const label = row && (row.label || row.key) ? String(row.label || row.key) : 'Unknown';
          const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
          const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
          const cr = crPillHtml(row && row.cr);
          return '<div class="aov-card aov-card--leaderboard aov-card--leaderboard-type">' +
              '<div class="aov-card-left"><span class="aov-card-name leaderboard-type-name">' + escapeHtml(label || 'Unknown') + '</span></div>' +
              '<div class="aov-card-value"><span class="aov-card-value-main">' + escapeHtml(value) + '</span>' + cr + '</div>' +
            '</div>';
        }).join('');
        return;
      }

      // view === 'title'
      const mainBase = getMainBaseUrl();
      grid.innerHTML = list.map(function(row) {
        const title = row && row.title != null ? String(row.title) : 'Product';
        const handle = row && row.handle ? String(row.handle) : '';
        const thumb = row && row.thumb_url ? String(row.thumb_url) : '';
        const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
        const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
        const cr = crPillHtml(row && row.cr);
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '';
        const thumbInner = '<span class="thumb-wrap">' +
            (thumb
              ? '<img class="landing-thumb" src="' + escapeHtml(hotImgSquare(thumb) || thumb) + '" alt="" loading="lazy" onerror="this.remove()">'
              : '') +
          '</span>';
        const img = productUrl
          ? '<a class="leaderboard-thumb-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener" aria-label="Open product: ' + escapeHtml(title || 'Product') + '">' + thumbInner + '</a>'
          : thumbInner;
        return '<div class="aov-card aov-card--leaderboard aov-card--leaderboard-title">' +
            '<div class="aov-card-left">' +
              img +
              '<span class="aov-card-name sr-only">' + escapeHtml(title || 'Product') + '</span>' +
            '</div>' +
            '<div class="aov-card-value"><span class="aov-card-value-main">' + escapeHtml(value) + '</span>' + cr + '</div>' +
          '</div>';
      }).join('');
    }

    // ── Product Type Tables (Necklaces, Bracelets, Earrings, Sets, Charms, Extras) ──
    var TYPE_TABLE_DEFS = [
      { id: 'necklaces', keys: ['necklaces', 'necklace'] },
      { id: 'bracelets', keys: ['bracelets', 'bracelet'] },
      { id: 'earrings',  keys: ['earrings', 'earring'] },
      { id: 'sets',      keys: ['jewellery sets', 'jewellery set', 'jewelry sets', 'jewelry set', 'sets', 'set'] },
      { id: 'charms',    keys: ['charms', 'charm'] },
      { id: 'extras',    keys: ['extras', 'extra'] },
    ];
    var TYPE_TABLE_PAGE_SIZE = 10;
    var typeTablePages = {};
    TYPE_TABLE_DEFS.forEach(function(d) { typeTablePages[d.id] = 1; });

    function getTypeProducts(data, def) {
      if (!data || !data.productsByType) return [];
      var out = [];
      for (var i = 0; i < def.keys.length; i++) {
        var arr = data.productsByType[def.keys[i]];
        if (Array.isArray(arr)) out = out.concat(arr);
      }
      return out;
    }

    function renderTypeTable(data, def) {
      var tbody = document.getElementById('type-' + def.id + '-body');
      if (!tbody) return;
      var rows = getTypeProducts(data, def);
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (leaderboardLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('type-' + def.id, 1, 1);
        return;
      }
      var totalPages = Math.max(1, Math.ceil(rows.length / TYPE_TABLE_PAGE_SIZE));
      var page = clampPage(typeTablePages[def.id] || 1, totalPages);
      typeTablePages[def.id] = page;
      updateCardPagination('type-' + def.id, page, totalPages);
      var start = (page - 1) * TYPE_TABLE_PAGE_SIZE;
      var pageRows = rows.slice(start, start + TYPE_TABLE_PAGE_SIZE);
      const mainBase = getMainBaseUrl();
      tbody.innerHTML = pageRows.map(function(r) {
        var title = r && r.title ? String(r.title) : '—';
        var orders = r && r.orders != null ? Number(r.orders) : 0;
        var sessions = r && r.sessions != null ? Number(r.sessions) : 0;
        var rev = r && r.revenueGbp != null ? formatRevenueTableHtml(r.revenueGbp) : '—';
        var cr = r && r.cr != null ? pct(r.cr) : '—';
        var handle = r && r.handle ? String(r.handle) : '';
        var thumb = r && r.thumb_url ? String(r.thumb_url) : '';
        var productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '';
        var thumbUrl = thumb ? (hotImgSquare(thumb) || thumb) : '';
        var thumbImg = '<span class="thumb-wrap">' +
          (thumbUrl ? '<img class="landing-thumb" src="' + escapeHtml(thumbUrl) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
        '</span>';
        var thumbHtml = productUrl ? '<a href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener">' + thumbImg + '</a>' : thumbImg;
        var name = '<span class="bs-name" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</span>';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell">' + thumbHtml + ' ' + name + '</div></div>' +
          '<div class="grid-cell" role="cell">' + formatSessions(orders) + '</div>' +
          '<div class="grid-cell" role="cell">' + formatSessions(sessions) + '</div>' +
          '<div class="grid-cell" role="cell">' + rev + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderAllTypeTables(data) {
      TYPE_TABLE_DEFS.forEach(function(def) { renderTypeTable(data, def); });
    }

    (function initTypeTablePagination() {
      TYPE_TABLE_DEFS.forEach(function(def) {
        var wrap = document.getElementById('type-' + def.id + '-pagination');
        if (!wrap) return;
        wrap.addEventListener('click', function(e) {
          var link = e.target.closest('a[data-page]');
          if (!link) return;
          e.preventDefault();
          if (link.closest('.page-item.disabled') || link.closest('.page-item.active')) return;
          var pg = parseInt(link.dataset.page, 10);
          if (!pg || pg < 1) return;
          typeTablePages[def.id] = pg;
          renderTypeTable(leaderboardCache, def);
        });
      });
    })();

    (function initProductsLeaderboardResizeWatcher() {
      let raf = null;
      function schedule() {
        if (activeMainTab !== 'products') return;
        if (!leaderboardCache && !leaderboardLoading) return;
        if (typeof requestAnimationFrame !== 'function') {
          renderProductsLeaderboard(leaderboardCache);
          return;
        }
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function() {
          raf = null;
          if (activeMainTab !== 'products') return;
          renderProductsLeaderboard(leaderboardCache);
        });
      }
      try { window.addEventListener('resize', schedule); } catch (_) {}
    })();

    function fetchFinishes(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        finishesLoading = false;
        finishesCache = null;
        if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(null);
        return Promise.resolve(null);
      }
      finishesLoading = true;
      if (!finishesCache && normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(null);
      let url = API + '/api/shopify-finishes?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          finishesCache = data;
          if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(data);
          return data;
        })
        .catch(function() { finishesCache = null; finishesLoading = false; if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(null); return null; })
        .finally(function() { finishesLoading = false; });
    }

    function fetchLengths(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        lengthsLoading = false;
        lengthsCache = null;
        if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(null);
        return Promise.resolve(null);
      }
      lengthsLoading = true;
      if (!lengthsCache && normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(null);
      let url = API + '/api/shopify-lengths?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          lengthsCache = data;
          if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(data);
          return data;
        })
        .catch(function() { lengthsCache = null; lengthsLoading = false; if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(null); return null; })
        .finally(function() { lengthsLoading = false; });
    }

    function fetchChainStyles(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        chainStylesLoading = false;
        chainStylesCache = null;
        return Promise.resolve(null);
      }
      chainStylesLoading = true;
      let url = API + '/api/shopify-chain-styles?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          chainStylesCache = data;
          chainStylesLoading = false;
          return data;
        })
        .catch(function() { chainStylesCache = null; chainStylesLoading = false; return null; })
        .finally(function() { chainStylesLoading = false; });
    }

    function fetchBestVariants(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        bestVariantsCache = null;
        renderBestVariants(null);
        return Promise.resolve(null);
      }
      let url = API + '/api/shopify-best-variants?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange()) +
          '&page=' + encodeURIComponent(String(bestVariantsPage || 1)) +
          '&pageSize=' + encodeURIComponent(String(TOP_TABLE_PAGE_SIZE));
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, status: r.status, data: data || {} }; }).catch(function() { return { ok: r.ok, status: r.status, data: {} }; }); })
        .then(function(result) {
          if (result.ok) {
            bestVariantsCache = result.data;
            renderBestVariants(result.data);
            return result.data;
          }
          var msg = (result.data && result.data.error) ? result.data.error : ('Error ' + result.status);
          if (result.data && result.data.hint) msg += '. ' + result.data.hint;
          bestVariantsCache = null;
          renderBestVariants(null, msg);
          return null;
        })
        .catch(function() { bestVariantsCache = null; renderBestVariants(null); return null; });
    }

    function renderBestVariants(data, errorMessage) {
      const tbody = document.getElementById('best-variants-body');
      if (!tbody) return;
      if (!data || !Array.isArray(data.bestVariants)) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (errorMessage ? escapeHtml(errorMessage) : 'No shop or no data') + '</div></div>';
        updateSortHeadersInContainer(document.getElementById('best-variants-table'), tableSortState.bestVariants.by, tableSortState.bestVariants.dir);
        updateCardPagination('best-variants', 1, 1);
        return;
      }
      const rows = data.bestVariants.slice();
      const bvBy = (tableSortState.bestVariants.by || 'rev').toString().trim().toLowerCase();
      const bvDir = (tableSortState.bestVariants.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      function displayVariantName(v) {
        const variantName = (v && v.variant_title && String(v.variant_title).trim()) ? String(v.variant_title).trim() : 'Default';
        const productName = (v && v.title && String(v.title).trim()) ? String(v.title).trim() : '';
        return variantName + (productName ? (' \u2014 ' + productName) : '');
      }
      rows.sort(function(a, b) {
        var primary = 0;
        if (bvBy === 'variant') primary = cmpNullableText(displayVariantName(a), displayVariantName(b), bvDir);
        else if (bvBy === 'sales') primary = cmpNullableNumber(a && a.orders, b && b.orders, bvDir);
        else if (bvBy === 'clicks') primary = cmpNullableNumber(a && a.clicks, b && b.clicks, bvDir);
        else if (bvBy === 'rev') primary = cmpNullableNumber(a && a.revenue, b && b.revenue, bvDir);
        else if (bvBy === 'cr') {
          primary = cmpNullableNumber(a && a.cr, b && b.cr, bvDir) ||
            cmpNullableNumber(a && a.orders, b && b.orders, 'desc');
        }
        return primary ||
          cmpNullableNumber(a && a.revenue, b && b.revenue, 'desc') ||
          cmpNullableNumber(a && a.orders, b && b.orders, 'desc') ||
          cmpNullableText(displayVariantName(a), displayVariantName(b), 'asc');
      });
      const pageSize = (data && typeof data.pageSize === 'number' && data.pageSize > 0) ? data.pageSize : TOP_TABLE_PAGE_SIZE;
      const totalCount = (data && typeof data.totalCount === 'number' && data.totalCount >= 0) ? data.totalCount : rows.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      bestVariantsPage = clampPage((data && typeof data.page === 'number') ? data.page : bestVariantsPage, totalPages);
      updateCardPagination('best-variants', bestVariantsPage, totalPages);
      if (rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No orders in this range</div></div>';
        updateSortHeadersInContainer(document.getElementById('best-variants-table'), bvBy, bvDir);
        return;
      }
      tbody.innerHTML = rows.map(function(v) {
        const mainBase = getMainBaseUrl();
        const productUrl = (mainBase && v && v.handle) ? (mainBase + '/products/' + encodeURIComponent(String(v.handle))) : '';
        const thumbUrl = (v && v.thumb_url) ? (hotImgSquare(String(v.thumb_url)) || String(v.thumb_url)) : null;
        const ogThumb = productUrl ? ((API || '') + '/api/og-thumb?url=' + encodeURIComponent(productUrl) + '&width=100') : '';
        const thumbSrc = thumbUrl || ogThumb || '';
        const thumbImg = '<span class="thumb-wrap">' +
          (thumbSrc ? '<img class="landing-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
        '</span>';
        const thumb = productUrl
          ? '<a href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener">' + thumbImg + '</a>'
          : thumbImg;

        const nameText = displayVariantName(v);
        const name = '<span class="bs-name" title="' + escapeHtml(nameText) + '">' + escapeHtml(nameText) + '</span>';

        const ordersNum = (v && typeof v.orders === 'number') ? v.orders : (v && v.orders != null ? Number(v.orders) : 0);
        const orders = formatSessions(Number(ordersNum) || 0);
        const clicks = (v && typeof v.clicks === 'number') ? formatSessions(v.clicks) : '\u2014';
        const revenue = formatRevenueTableHtml(v && v.revenue != null ? v.revenue : null);
        const crVal = (v && typeof v.cr === 'number') ? v.cr : null;
        const cr = crVal != null ? pct(crVal) : '\u2014';

        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell">' + thumb + ' ' + name + '</div></div>' +
          '<div class="grid-cell" role="cell">' + orders + '</div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
      updateSortHeadersInContainer(document.getElementById('best-variants-table'), bvBy, bvDir);
    }

    let productsChartInstance = null;
    let productsChartData = null;
    let productsChartType = 'bar';

    function renderProductsChart(data, chartType) {
      const el = document.getElementById('products-chart');
      if (!el) return;

      if (typeof ApexCharts === 'undefined') {
        setTimeout(function() { renderProductsChart(data, chartType); }, 200);
        return;
      }

      if (productsChartInstance) {
        productsChartInstance.destroy();
        productsChartInstance = null;
      }

      if (data) productsChartData = data;
      if (chartType) productsChartType = chartType;
      var d = productsChartData;

      if (!d || !Array.isArray(d.bestSellers) || d.bestSellers.length === 0) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:280px;color:var(--tblr-secondary);font-size:.875rem">No product data available</div>';
        return;
      }

      const products = d.bestSellers.slice().sort(function(a, b) {
        return (b.revenue || 0) - (a.revenue || 0);
      }).slice(0, 10);

      const categories = products.map(function(p) {
        const title = p.title || 'Unknown Product';
        return title.length > 30 ? title.substring(0, 27) + '...' : title;
      });
      const revenues = products.map(function(p) { return p.revenue || 0; });

      var ct = productsChartType;
      var isBar = ct === 'bar';
      var isLine = ct === 'line';
      var isArea = ct === 'area';

      var fillConfig = isLine ? { type: 'solid', opacity: 0 }
        : isArea ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.15, opacityTo: 0.02, stops: [0, 100] } }
        : { type: 'solid', opacity: 1 };

      const options = {
        chart: {
          type: isBar ? 'bar' : ct,
          height: 280,
          fontFamily: 'Inter, sans-serif',
          toolbar: { show: false }
        },
        series: [{
          name: 'Revenue',
          data: revenues
        }],
        colors: ['#0d9488'],
        plotOptions: isBar ? {
          bar: {
            horizontal: true,
            borderRadius: 4,
            barHeight: '70%'
          }
        } : {},
        stroke: { width: isBar ? 0 : 2, curve: 'smooth' },
        fill: fillConfig,
        markers: { size: isLine ? 3 : 0, hover: { size: 5 } },
        dataLabels: { enabled: false },
        xaxis: {
          categories: categories,
          labels: {
            style: { fontSize: '11px' },
            formatter: isBar ? function(value) {
              return '£' + Number(value).toLocaleString();
            } : undefined
          }
        },
        yaxis: {
          labels: {
            style: { fontSize: '11px' },
            formatter: !isBar ? function(value) {
              return '£' + Number(value).toLocaleString();
            } : undefined
          }
        },
        tooltip: {
          y: {
            formatter: function(value) {
              return '£' + Number(value).toFixed(2);
            }
          }
        },
        grid: {
          borderColor: '#f1f1f1',
          padding: { left: 0, right: 0 }
        }
      };

      el.innerHTML = '';
      productsChartInstance = new ApexCharts(el, options);
      productsChartInstance.render();
      initProductsChartSwitcher();
    }

    function initProductsChartSwitcher() {
      var el = document.getElementById('products-chart');
      if (!el) return;
      var card = el.closest('.card');
      if (!card) return;
      var header = card.querySelector('.card-header');
      if (!header || header.querySelector('.chart-type-switcher')) return;

      var wrap = document.createElement('div');
      wrap.className = 'chart-type-switcher ms-auto d-flex gap-1';
      var types = [
        { type: 'bar', icon: 'ti-chart-bar', label: 'Bar' },
        { type: 'area', icon: 'ti-chart-area-line', label: 'Area' },
        { type: 'line', icon: 'ti-chart-line', label: 'Line' }
      ];
      types.forEach(function(t) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-icon btn-ghost-secondary btn-sm' + (t.type === productsChartType ? ' active' : '');
        btn.setAttribute('aria-label', t.label);
        btn.innerHTML = '<i class="ti ' + t.icon + '"></i>';
        btn.addEventListener('click', function() {
          wrap.querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderProductsChart(null, t.type);
        });
        wrap.appendChild(btn);
      });
      header.appendChild(wrap);
    }

    function renderBestSellers(data, errorMessage) {
      const tbody = document.getElementById('best-sellers-body');
      if (!tbody) return;
      if (!data || !Array.isArray(data.bestSellers)) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (errorMessage ? escapeHtml(errorMessage) : 'No shop or no data') + '</div></div>';
        updateBestSellersSortHeaders();
        updateCardPagination('best-sellers', 1, 1);
        return;
      }
      const rows = data.bestSellers.slice();
      const sortKey = (bestSellersSortBy || 'rev').toString().trim().toLowerCase();
      const sortDir = (bestSellersSortDir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      rows.sort(function(a, b) {
        if (sortKey === 'title') return cmpNullableText(a && a.title, b && b.title, sortDir);
        if (sortKey === 'orders') return cmpNullableNumber(a && a.orders, b && b.orders, sortDir);
        if (sortKey === 'clicks') return cmpNullableNumber(a && a.clicks, b && b.clicks, sortDir);
        if (sortKey === 'rev') return cmpNullableNumber(a && a.revenue, b && b.revenue, sortDir);
        if (sortKey === 'cr') {
          return cmpNullableNumber(a && a.cr, b && b.cr, sortDir) ||
            cmpNullableNumber(a && a.orders, b && b.orders, 'desc');
        }
        return 0;
      });
      const pageSize = (data && typeof data.pageSize === 'number' && data.pageSize > 0) ? data.pageSize : TOP_TABLE_PAGE_SIZE;
      const totalCount = (data && typeof data.totalCount === 'number' && data.totalCount >= 0) ? data.totalCount : rows.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      bestSellersPage = clampPage((data && typeof data.page === 'number') ? data.page : bestSellersPage, totalPages);
      updateCardPagination('best-sellers', bestSellersPage, totalPages);
      if (rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No orders in this range</div></div>';
        updateBestSellersSortHeaders();
        return;
      }
      tbody.innerHTML = rows.map(function(p) {
        const mainBase = getMainBaseUrl();
        const productUrl = (mainBase && p.handle) ? (mainBase + '/products/' + encodeURIComponent(String(p.handle))) : '';
        const thumbUrl = p.thumb_url ? (hotImgSquare(String(p.thumb_url)) || String(p.thumb_url)) : null;
        const ogThumb = productUrl ? ((API || '') + '/api/og-thumb?url=' + encodeURIComponent(productUrl) + '&width=100') : '';
        const thumbSrc = thumbUrl || ogThumb || '';
        const thumbImg = '<span class="thumb-wrap">' +
          (thumbSrc ? '<img class="landing-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
        '</span>';
        const thumb = productUrl ? '<a href="' + productUrl + '" target="_blank" rel="noopener">' + thumbImg + '</a>' : thumbImg;
        const name = '<span class="bs-name" title="' + escapeHtml(p.title) + '">' + escapeHtml(p.title) + '</span>';
        const orders = String(p.orders != null ? p.orders : 0);
        const clicks = (typeof p.clicks === 'number') ? formatSessions(p.clicks) : '\u2014';
        const revenue = formatRevenueTableHtml(p.revenue);
        const cr = p.cr != null ? pct(p.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell">' + thumb + ' ' + name + '</div></div>' +
          '<div class="grid-cell" role="cell">' + orders + '</div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
      updateBestSellersSortHeaders();
    }

    function updateBestSellersSortHeaders() {
      document.querySelectorAll('#best-sellers-wrap .grid-cell.sortable').forEach(function(th) {
        var col = th.getAttribute('data-sort');
        th.classList.remove('th-sort-asc', 'th-sort-desc');
        th.setAttribute('aria-sort', bestSellersSortBy === col ? (bestSellersSortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        if (bestSellersSortBy === col) th.classList.add(bestSellersSortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
      });
    }

    function setupBestSellersSort() {
      document.querySelectorAll('#best-sellers-wrap .grid-cell.sortable').forEach(function(th) {
        function activate() {
          var col = (th.getAttribute('data-sort') || '').trim();
          if (!col) return;
          if (bestSellersSortBy === col) bestSellersSortDir = bestSellersSortDir === 'asc' ? 'desc' : 'asc';
          else { bestSellersSortBy = col; bestSellersSortDir = col === 'title' ? 'asc' : 'desc'; }
          bestSellersPage = 1;
          updateBestSellersSortHeaders();
          fetchBestSellers();
        }
        th.addEventListener('click', function(e) {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          activate();
        });
        th.addEventListener('keydown', function(e) {
          if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          activate();
        });
      });
    }

    function asSortText(v) {
      if (v == null) return '';
      return String(v).trim().toLowerCase();
    }

    function asFiniteNumber(v) {
      const n = (typeof v === 'number') ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }

    function cmpNullableText(a, b, dir) {
      const da = asSortText(a);
      const db = asSortText(b);
      const d = dir === 'asc' ? 'asc' : 'desc';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      if (da === db) return 0;
      if (d === 'asc') return da < db ? -1 : 1;
      return da < db ? 1 : -1;
    }

    function cmpNullableNumber(a, b, dir) {
      const na = asFiniteNumber(a);
      const nb = asFiniteNumber(b);
      const d = dir === 'asc' ? 'asc' : 'desc';
      if (na == null && nb == null) return 0;
      if (na == null) return 1;
      if (nb == null) return -1;
      if (na === nb) return 0;
      return d === 'asc' ? (na - nb) : (nb - na);
    }

    function updateSortHeadersInContainer(container, sortBy, sortDir) {
      const root = typeof container === 'string' ? document.querySelector(container) : container;
      if (!root) return;
      root.querySelectorAll('.grid-cell.sortable').forEach(function(th) {
        var col = (th.getAttribute('data-sort') || '').trim();
        th.classList.remove('th-sort-asc', 'th-sort-desc');
        th.setAttribute('aria-sort', sortBy === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        if (sortBy === col) th.classList.add(sortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
      });
    }

    function setupTableSortHeaders(container, state, defaults, onChange) {
      const root = typeof container === 'string' ? document.querySelector(container) : container;
      if (!root || !state) return;
      root.querySelectorAll('.grid-cell.sortable').forEach(function(th) {
        function activate() {
          var col = (th.getAttribute('data-sort') || '').trim();
          if (!col) return;
          var prevCol = state.by;
          if (state.by === col) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
          else { state.by = col; state.dir = (defaults && defaults[col]) ? defaults[col] : 'asc'; }
          state.dir = state.dir === 'asc' ? 'asc' : 'desc';
          updateSortHeadersInContainer(root, state.by, state.dir);
          if (typeof onChange === 'function') onChange({ by: state.by, dir: state.dir, columnChanged: prevCol !== state.by });
        }
        th.addEventListener('click', function(e) {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          activate();
        });
        th.addEventListener('keydown', function(e) {
          if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          activate();
        });
      });
      state.dir = state.dir === 'asc' ? 'asc' : 'desc';
      updateSortHeadersInContainer(root, state.by, state.dir);
    }

    function setupAllTableSorts() {
      setupTableSortHeaders(document.getElementById('country-table'), tableSortState.country, TABLE_SORT_DEFAULTS.country, function(info) {
        if (info && info.columnChanged) countryPage = 1;
        renderCountry(statsCache);
      });
      setupTableSortHeaders(document.getElementById('best-geo-products-table'), tableSortState.bestGeoProducts, TABLE_SORT_DEFAULTS.bestGeoProducts, function(info) {
        if (info && info.columnChanged) bestGeoProductsPage = 1;
        renderBestGeoProducts(statsCache);
      });
      setupTableSortHeaders(document.getElementById('best-variants-table'), tableSortState.bestVariants, TABLE_SORT_DEFAULTS.bestVariants, function(info) {
        if (info && info.columnChanged) {
          bestVariantsPage = 1;
          fetchBestVariants();
          return;
        }
        if (bestVariantsCache) renderBestVariants(bestVariantsCache);
        else fetchBestVariants();
      });
      setupTableSortHeaders(document.getElementById('traffic-sources-table'), tableSortState.trafficSources, TABLE_SORT_DEFAULTS.trafficSources, function() {
        renderTrafficTables(trafficCache || {});
      });
      setupTableSortHeaders(document.getElementById('traffic-types-table'), tableSortState.trafficTypes, TABLE_SORT_DEFAULTS.trafficTypes, function() {
        renderTrafficTables(trafficCache || {});
      });
    }

    function formatSessions(n) {
      if (n == null || typeof n !== 'number') return '—';
      return n.toLocaleString();
    }

    function clampPage(p, totalPages) {
      const n = typeof p === 'number' ? p : parseInt(String(p), 10);
      if (!Number.isFinite(n)) return 1;
      return Math.min(Math.max(1, n), Math.max(1, totalPages || 1));
    }

    function buildPaginationHtml(page, totalPages) {
      var p = Math.max(1, page);
      var tp = Math.max(1, totalPages);
      var chevL = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6l6 6"/></svg>';
      var chevR = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6l-6 6"/></svg>';
      var h = '<ul class="pagination m-0">';
      h += '<li class="page-item' + (p <= 1 ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (p - 1) + '" tabindex="-1" aria-label="Previous">' + chevL + '</a></li>';
      // Build page numbers with ellipsis
      var pages = [];
      if (tp <= 7) {
        for (var i = 1; i <= tp; i++) pages.push(i);
      } else {
        pages.push(1);
        if (p > 3) pages.push('...');
        var start = Math.max(2, p - 1);
        var end = Math.min(tp - 1, p + 1);
        if (p <= 3) { start = 2; end = 4; }
        if (p >= tp - 2) { start = tp - 3; end = tp - 1; }
        for (var i = start; i <= end; i++) pages.push(i);
        if (p < tp - 2) pages.push('...');
        pages.push(tp);
      }
      for (var j = 0; j < pages.length; j++) {
        var pg = pages[j];
        if (pg === '...') {
          h += '<li class="page-item disabled"><span class="page-link">...</span></li>';
        } else {
          h += '<li class="page-item' + (pg === p ? ' active' : '') + '"><a class="page-link" href="#" data-page="' + pg + '">' + pg + '</a></li>';
        }
      }
      h += '<li class="page-item' + (p >= tp ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (p + 1) + '" aria-label="Next">' + chevR + '</a></li>';
      h += '</ul>';
      return h;
    }

    function updateCardPagination(prefix, page, totalPages) {
      var wrap = document.getElementById(prefix + '-pagination');
      if (!wrap) return;
      var pages = Math.max(1, totalPages || 1);
      var show = pages > 1;
      wrap.dataset.paginated = show ? '1' : '0';
      wrap.dataset.pages = String(pages);
      wrap.dataset.page = String(page);
      wrap.classList.toggle('is-hidden', !show);
      if (show) wrap.innerHTML = buildPaginationHtml(page, pages);
    }

    function scheduleBreakdownSync() {
      // No-op: layout is handled via CSS grid/flex.
    }

    function renderSales(data) {
      const sales = data.sales || {};
      const salesTodayEl = document.getElementById('sales-today');
      const range = getStatsRange();
      const baseSales = (sales[range] != null ? sales[range] : 0);
      if (salesTodayEl) salesTodayEl.textContent = formatRevenue(baseSales);
      const salesYesterdayEl = document.getElementById('sales-yesterday');
      if (salesYesterdayEl) salesYesterdayEl.textContent = formatRevenue(sales.yesterday);
    }

    function renderConversion(data) {
      const c = data.conversion || {};
      const range = getStatsRange();
      document.getElementById('conversion-range').textContent = pct(c[range]);
      const productCr = (data.productConversion || {})[range];
      const productCrEl = document.getElementById('conversion-product-cr');
      if (productCrEl) productCrEl.textContent = productCr != null ? pct(productCr) : '\u2014';
    }

    function renderSessions(data) {
      const breakdown = data && data.trafficBreakdown ? data.trafficBreakdown : {};
      const forRange = breakdown[getStatsRange()];
      const forYesterday = breakdown.yesterday;
      const main = forRange != null ? forRange.human_sessions : null;
      const yesterday = forYesterday != null ? forYesterday.human_sessions : null;
      const sessionsRangeEl = document.getElementById('sessions-range');
      const sessionsYesterdayEl = document.getElementById('sessions-yesterday');
      if (sessionsRangeEl) sessionsRangeEl.textContent = formatSessions(main);
      if (sessionsYesterdayEl) sessionsYesterdayEl.textContent = formatSessions(yesterday);
    }

    var breakdownAovPage = 1;
    function renderAov(data) {
      const rows = (data.country || {})[getStatsRange()] || [];
      const tbody = document.getElementById('breakdown-aov-body');
      if (!tbody) return;
      const filtered = rows.filter(r => (r && (r.revenue != null || r.aov != null || r.conversion != null)));
      if (filtered.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No data</div></div>';
        updateCardPagination('breakdown-aov', 1, 1);
        return;
      }
      const list = filtered.slice();
      list.sort(function(a, b) {
        return cmpNullableNumber(a && a.revenue, b && b.revenue, 'desc') ||
          cmpNullableNumber(a && a.aov, b && b.aov, 'desc') ||
          cmpNullableNumber(a && a.conversion, b && b.conversion, 'desc');
      });
      var totalPages = Math.max(1, Math.ceil(list.length / TOP_TABLE_PAGE_SIZE));
      breakdownAovPage = clampPage(breakdownAovPage, totalPages);
      updateCardPagination('breakdown-aov', breakdownAovPage, totalPages);
      var start = (breakdownAovPage - 1) * TOP_TABLE_PAGE_SIZE;
      var pageRows = list.slice(start, start + TOP_TABLE_PAGE_SIZE);
      tbody.innerHTML = pageRows.map(r => {
        const iso = (r.country_code || 'XX').toUpperCase().slice(0, 2);
        const label = countryLabelFull(iso);
        const flag = flagImg(iso, label);
        const revenue = r && r.revenue != null ? formatRevenueTableHtml(r.revenue) : '—';
        const aov = r && r.aov != null ? formatRevenueTableHtml(r.aov) : '—';
        const cr = r && r.conversion != null ? pct(r.conversion) : '—';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="country-cell">' + flag + '<span class="country-label"><span class="country-name">' + escapeHtml(label) + '</span></span></span></div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
          '<div class="grid-cell" role="cell">' + aov + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderFinishes(data) {
      const grid = document.getElementById('finishes-cards-grid');
      if (!grid) return;
      const rows = (data && Array.isArray(data.finishes)) ? data.finishes : [];
      if (rows.length === 0) {
        const msg = finishesLoading ? 'Loading finishes…' : 'No data';
        grid.innerHTML = '<div class="aov-card aov-card-empty">' + escapeHtml(msg) + '</div>';
        return;
      }
      function iconFor(key) {
        const k = (key || '').toString().trim().toLowerCase();
        if (k === 'gold') return '<span class="finish-icon finish-icon-gold" aria-hidden="true"></span>';
        if (k === 'silver') return '<span class="finish-icon finish-icon-silver" aria-hidden="true"></span>';
        if (k === 'vermeil') return '<span class="finish-icon finish-icon-vermeil" aria-hidden="true"></span>';
        if (k === 'solid_silver' || k === 'solid-silver') return '<span class="finish-icon finish-icon-solid-silver" aria-hidden="true"></span>';
        return '<span class="finish-icon" aria-hidden="true"></span>';
      }
      const ordered = rows.slice();
      const orderIndex = { gold: 0, silver: 1, vermeil: 2, solid_silver: 3, 'solid-silver': 3 };
      ordered.sort(function(a, b) {
        const primary = cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc');
        if (primary) return primary;
        const ak = a && a.key != null ? String(a.key) : '';
        const bk = b && b.key != null ? String(b.key) : '';
        const ai = Object.prototype.hasOwnProperty.call(orderIndex, ak) ? orderIndex[ak] : 99;
        const bi = Object.prototype.hasOwnProperty.call(orderIndex, bk) ? orderIndex[bk] : 99;
        return ai - bi;
      });
      grid.innerHTML = ordered.map(function(r) {
        const label = (r && r.label != null) ? String(r.label) : '';
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '—';
        const cr = crPillHtml(r && r.cr);
        return '<div class="aov-card">' +
          '<div class="aov-card-left">' + iconFor(r && r.key) + '<span class="aov-card-name">' + escapeHtml(label || '—') + '</span></div>' +
          '<div class="aov-card-value"><span class="aov-card-value-main">' + value + '</span>' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderLengths(data) {
      const grid = document.getElementById('finishes-cards-grid');
      if (!grid) return;
      const rows = (data && Array.isArray(data.lengths)) ? data.lengths : [];
      if (rows.length === 0) {
        const msg = lengthsLoading ? 'Loading lengths…' : 'No data';
        grid.innerHTML = '<div class="aov-card aov-card-empty">' + escapeHtml(msg) + '</div>';
        return;
      }
      const ordered = rows.slice();
      ordered.sort(function(a, b) {
        return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
          cmpNullableNumber(a && a.inches, b && b.inches, 'asc');
      });
      grid.innerHTML = ordered.map(function(r) {
        const inches = (r && r.inches != null) ? Number(r.inches) : null;
        const label = (r && r.label != null) ? String(r.label) : (inches != null && Number.isFinite(inches) ? (String(inches) + '"') : '');
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '—';
        const cr = crPillHtml(r && r.cr);
        const icon = '<span class="length-icon" aria-hidden="true"><span class="length-icon-text">' + escapeHtml(label || '—') + '</span></span>';
        const sr = '<span class="aov-card-name sr-only">' + escapeHtml((label || '—') + ' Inches') + '</span>';
        return '<div class="aov-card aov-card--length">' +
          '<div class="aov-card-left">' + icon + sr + '</div>' +
          '<div class="aov-card-value"><span class="aov-card-value-main">' + value + '</span>' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownTitlePage = 1;
    function renderBreakdownTitles(data) {
      const tbody = document.getElementById('breakdown-title-body');
      if (!tbody) return;
      const hasData = !!(data && data.ok);
      const list = hasData ? (data.byTitle || []) : [];
      if (!list.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (leaderboardLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-title', 1, 1);
        return;
      }
      var totalPages = Math.max(1, Math.ceil(list.length / TOP_TABLE_PAGE_SIZE));
      breakdownTitlePage = clampPage(breakdownTitlePage, totalPages);
      updateCardPagination('breakdown-title', breakdownTitlePage, totalPages);
      var start = (breakdownTitlePage - 1) * TOP_TABLE_PAGE_SIZE;
      var pageRows = list.slice(start, start + TOP_TABLE_PAGE_SIZE);
      const mainBase = getMainBaseUrl();
      tbody.innerHTML = pageRows.map(function(row) {
        const title = row && row.title != null ? String(row.title) : 'Product';
        const handle = row && row.handle ? String(row.handle) : '';
        const thumb = row && row.thumb_url ? String(row.thumb_url) : '';
        const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
        const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
        const cr = row && row.cr != null ? pct(row.cr) : '\u2014';
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '';
        const placeholderSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M8 12l2.5 2.5L16 9"></path></svg>';
        const imgInner = '<span class="thumb-wrap">' +
          (thumb
            ? '<img class="landing-thumb" src="' + escapeHtml(hotImgSquare(thumb) || thumb) + '" alt="" loading="lazy" onerror="this.remove()">'
            : '') +
          '</span>';
        const img = productUrl
          ? '<a href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener" aria-label="Open product: ' + escapeHtml(title || 'Product') + '">' + imgInner + '</a>'
          : imgInner;
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + img + '<span class="breakdown-label"><span class="breakdown-product-name">' + escapeHtml(title) + '</span><span class="sr-only">' + escapeHtml(title) + '</span></span></span></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(value) + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderBreakdownTypes(data) {
      const tbody = document.getElementById('breakdown-type-body');
      if (!tbody) return;
      const hasData = !!(data && data.ok);
      const list = hasData ? (data.byType || []) : [];
      if (!list.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (leaderboardLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        return;
      }
      const iconSvg = '<span class="breakdown-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7"></path><path d="M16 19l2 2 4-4"></path></svg></span>';
      tbody.innerHTML = list.map(function(row) {
        const label = row && (row.label || row.key) ? String(row.label || row.key) : 'Unknown';
        const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
        const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
        const cr = row && row.cr != null ? pct(row.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconSvg + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(value) + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownFinishPage = 1;
    function renderBreakdownFinishes(data) {
      const tbody = document.getElementById('breakdown-finish-body');
      if (!tbody) return;
      const rows = (data && Array.isArray(data.finishes)) ? data.finishes : [];
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (finishesLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-finish', 1, 1);
        return;
      }
      function iconFor(key) {
        const k = (key || '').toString().trim().toLowerCase();
        if (k === 'gold') return '<span class="finish-icon finish-icon-gold" aria-hidden="true"></span>';
        if (k === 'silver') return '<span class="finish-icon finish-icon-silver" aria-hidden="true"></span>';
        if (k === 'vermeil') return '<span class="finish-icon finish-icon-vermeil" aria-hidden="true"></span>';
        if (k === 'solid_silver' || k === 'solid-silver') return '<span class="finish-icon finish-icon-solid-silver" aria-hidden="true"></span>';
        return '<span class="breakdown-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.8 5.5H19l-4.4 3.2L16.4 16 12 12.8 7.6 16l1.8-5.3L5 7.5h5.2z"></path></svg></span>';
      }
      var ordered = rows.slice();
      ordered.sort(function(a, b) { return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc'); });
      var totalPages = Math.max(1, Math.ceil(ordered.length / BREAKDOWN_PAGE_SIZE));
      breakdownFinishPage = clampPage(breakdownFinishPage, totalPages);
      updateCardPagination('breakdown-finish', breakdownFinishPage, totalPages);
      var start = (breakdownFinishPage - 1) * BREAKDOWN_PAGE_SIZE;
      var pageRows = ordered.slice(start, start + BREAKDOWN_PAGE_SIZE);
      tbody.innerHTML = pageRows.map(function(r) {
        const label = (r && r.label != null) ? String(r.label) : '\u2014';
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '\u2014';
        const cr = r && r.cr != null ? pct(r.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconFor(r && r.key) + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + value + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownLengthPage = 1;
    function renderBreakdownLengths(data) {
      const tbody = document.getElementById('breakdown-length-body');
      if (!tbody) return;
      const rows = (data && Array.isArray(data.lengths)) ? data.lengths : [];
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (lengthsLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-length', 1, 1);
        return;
      }
      var ordered = rows.slice();
      ordered.sort(function(a, b) {
        return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
          cmpNullableNumber(a && a.inches, b && b.inches, 'asc');
      });
      var totalPages = Math.max(1, Math.ceil(ordered.length / BREAKDOWN_PAGE_SIZE));
      breakdownLengthPage = clampPage(breakdownLengthPage, totalPages);
      updateCardPagination('breakdown-length', breakdownLengthPage, totalPages);
      var start = (breakdownLengthPage - 1) * BREAKDOWN_PAGE_SIZE;
      var pageRows = ordered.slice(start, start + BREAKDOWN_PAGE_SIZE);
      const iconSvg = '<span class="breakdown-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M6 7v10"></path><path d="M10 7v6"></path><path d="M14 7v6"></path><path d="M18 7v10"></path></svg></span>';
      tbody.innerHTML = pageRows.map(function(r) {
        const inches = (r && r.inches != null) ? Number(r.inches) : null;
        const label = (r && r.label != null) ? String(r.label) : (inches != null && Number.isFinite(inches) ? (String(inches) + '"') : '\u2014');
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '\u2014';
        const cr = r && r.cr != null ? pct(r.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconSvg + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + value + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownChainStylePage = 1;
    function renderBreakdownChainStyles(data) {
      const tbody = document.getElementById('breakdown-chainstyle-body');
      if (!tbody) return;
      const rows = (data && Array.isArray(data.chainStyles)) ? data.chainStyles : [];
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (chainStylesLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-chainstyle', 1, 1);
        return;
      }
      var ordered = rows.slice();
      ordered.sort(function(a, b) { return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc'); });
      var totalPages = Math.max(1, Math.ceil(ordered.length / BREAKDOWN_PAGE_SIZE));
      breakdownChainStylePage = clampPage(breakdownChainStylePage, totalPages);
      updateCardPagination('breakdown-chainstyle', breakdownChainStylePage, totalPages);
      var start = (breakdownChainStylePage - 1) * BREAKDOWN_PAGE_SIZE;
      var pageRows = ordered.slice(start, start + BREAKDOWN_PAGE_SIZE);
      const iconSvg = '<span class="breakdown-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></span>';
      tbody.innerHTML = pageRows.map(function(r) {
        const label = (r && r.label != null) ? String(r.label) : '\u2014';
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '\u2014';
        const cr = r && r.cr != null ? pct(r.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconSvg + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + value + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderCountry(data) {
      const c = data.country || {};
      const rows = c[getStatsRange()] || [];
      const tbody = document.getElementById('by-country-body');
      if (!tbody) return;
      if (rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No data</div></div>';
        updateSortHeadersInContainer(document.getElementById('country-table'), tableSortState.country.by, tableSortState.country.dir);
        updateCardPagination('country', 1, 1);
        return;
      }
      const list = rows.slice();
      const countryBy = (tableSortState.country.by || 'rev').toString().trim().toLowerCase();
      const countryDir = (tableSortState.country.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      function labelFor(r) {
        const code = (r && r.country_code != null ? String(r.country_code) : 'XX').toUpperCase().slice(0, 2);
        return countryLabel(code);
      }
      list.sort(function(a, b) {
        if (countryBy === 'country') return cmpNullableText(labelFor(a), labelFor(b), countryDir);
        if (countryBy === 'cr') return cmpNullableNumber(a && a.conversion, b && b.conversion, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        if (countryBy === 'sales') return cmpNullableNumber(a && a.converted, b && b.converted, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        if (countryBy === 'clicks') return cmpNullableNumber(a && a.total, b && b.total, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        if (countryBy === 'rev') return cmpNullableNumber(a && a.revenue, b && b.revenue, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        return 0;
      });

      lastCountryRowCount = list.length;
      var totalPages = Math.max(1, Math.ceil(list.length / COUNTRY_PAGE_SIZE));
      countryPage = clampPage(countryPage, totalPages);
      updateCardPagination('country', countryPage, totalPages);
      var start = (countryPage - 1) * COUNTRY_PAGE_SIZE;
      var pageRows = list.slice(start, start + COUNTRY_PAGE_SIZE);
      tbody.innerHTML = pageRows.map(r => {
        const code = (r.country_code || 'XX').toUpperCase().slice(0, 2);
        const label = countryLabel(code);
        const conversion = pct(r.conversion);
        const salesCount = r.converted != null ? Number(r.converted) : 0;
        const clicks = r.total != null ? formatSessions(r.total) : '—';
        const revenue = formatRevenueTableHtml(r.revenue);
        const flag = flagImg(code, label);
        const labelHtml = '<span class="country-label">' + escapeHtml(label) + '</span>';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="country-cell">' + flag + labelHtml + '</span></div>' +
          '<div class="grid-cell" role="cell">' + conversion + '</div>' +
          '<div class="grid-cell" role="cell">' + salesCount + '</div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
        '</div>';
      }).join('');
      updateSortHeadersInContainer(document.getElementById('country-table'), countryBy, countryDir);
      scheduleBreakdownSync();
    }

    // Countries pie chart
    let countriesPieChartInstance = null;
    function renderCountriesPieChart(data) {
      const el = document.getElementById('countries-pie-chart');
      if (!el) return;

      if (typeof ApexCharts === 'undefined') {
        setTimeout(function() { renderCountriesPieChart(data); }, 200);
        return;
      }

      if (countriesPieChartInstance) {
        try {
          countriesPieChartInstance.destroy();
        } catch (_) {}
        countriesPieChartInstance = null;
      }

      const c = data.country || {};
      const rows = c[getStatsRange()] || [];

      if (rows.length === 0) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);">No data</div>';
        return;
      }

      // Sort by revenue and take top 10
      const sortedRows = rows.slice().sort((a, b) => (b.revenue || 0) - (a.revenue || 0)).slice(0, 10);
      const labels = sortedRows.map(r => {
        const code = (r.country_code || 'XX').toUpperCase().slice(0, 2);
        return countryLabel(code);
      });
      const revenues = sortedRows.map(r => r.revenue || 0);

      const options = {
        chart: {
          type: 'donut',
          height: 320,
          fontFamily: 'Inter, sans-serif',
          toolbar: { show: false }
        },
        series: revenues,
        labels: labels,
        colors: ['#4592e9', '#1673b4', '#32bdb0', '#179ea8', '#fa9f2e', '#fab05d', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e'],
        plotOptions: {
          pie: {
            donut: {
              size: '65%',
              labels: {
                show: true,
                total: {
                  show: true,
                  label: 'Total Revenue',
                  fontSize: '14px',
                  formatter: function(w) {
                    const total = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                    return '£' + Number(total).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                  }
                }
              }
            }
          }
        },
        dataLabels: {
          enabled: true,
          formatter: function(val) {
            return val.toFixed(1) + '%';
          }
        },
        legend: {
          position: 'bottom',
          fontSize: '12px'
        },
        tooltip: {
          y: {
            formatter: function(value) {
              return '£' + Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
          }
        }
      };

      try {
        countriesPieChartInstance = new ApexCharts(el, options);
        countriesPieChartInstance.render();
      } catch (err) {
        console.error('[countries-pie] Chart render error:', err);
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;">Chart rendering failed</div>';
      }
    }

    // Countries map chart
    let countriesMapChartInstance = null;
    function renderCountriesMapChart(data) {
      const el = document.getElementById('countries-map-chart');
      if (!el) return;

      if (typeof jsVectorMap === 'undefined') {
        setTimeout(function() { renderCountriesMapChart(data); }, 200);
        return;
      }

      if (countriesMapChartInstance) {
        try {
          countriesMapChartInstance.destroy();
        } catch (_) {}
        countriesMapChartInstance = null;
      }

      const c = data.country || {};
      const rows = c[getStatsRange()] || [];

      if (rows.length === 0) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);">No data</div>';
        return;
      }

      // Vector map (Tabler-style): revenue by country with tooltip details.
      const revenueByIso2 = {};
      const ordersByIso2 = {};
      for (const r of rows || []) {
        let iso = (r && r.country_code != null) ? String(r.country_code).trim().toUpperCase().slice(0, 2) : 'XX';
        if (!iso || iso === 'XX') continue;
        // Common alias
        if (iso === 'UK') iso = 'GB';
        const rev = (r && typeof r.revenue === 'number') ? r.revenue : 0;
        const ord = (r && r.converted != null) ? Number(r.converted) : 0;
        if (!Number.isFinite(rev) && !Number.isFinite(ord)) continue;
        revenueByIso2[iso] = (revenueByIso2[iso] || 0) + (Number.isFinite(rev) ? rev : 0);
        ordersByIso2[iso] = (ordersByIso2[iso] || 0) + (Number.isFinite(ord) ? ord : 0);
      }

      // Clean mount
      el.innerHTML = '';

      try {
        const border = (getComputedStyle(document.documentElement).getPropertyValue('--tblr-border-color') || '#e6e7e9').trim();
        const muted = (getComputedStyle(document.documentElement).getPropertyValue('--tblr-secondary') || '#626976').trim();
        countriesMapChartInstance = new jsVectorMap({
          selector: '#countries-map-chart',
          map: 'world',
          backgroundColor: 'transparent',
          zoomButtons: true,
          regionStyle: {
            initial: { fill: 'rgba(148,163,184,0.25)', stroke: border, strokeWidth: 0.7 },
            hover: { fill: 'rgba(69,146,233,0.35)' },
            selected: { fill: 'rgba(69,146,233,0.45)' },
          },
          series: {
            regions: [
              {
                attribute: 'fill',
                values: revenueByIso2,
                scale: ['rgba(69,146,233,0.15)', 'rgba(69,146,233,0.95)'],
                normalizeFunction: 'polynomial',
              }
            ]
          },
          onRegionTooltipShow: function(tooltip, code) {
            const iso = (code || '').toString().trim().toUpperCase();
            const name = (countriesMapChartInstance && typeof countriesMapChartInstance.getRegionName === 'function')
              ? (countriesMapChartInstance.getRegionName(iso) || iso)
              : iso;
            const rev = revenueByIso2[iso] || 0;
            const ord = ordersByIso2[iso] || 0;
            if (!rev && !ord) {
              tooltip.html('<div style="min-width:140px;font-weight:600">' + escapeHtml(name) + '</div>');
              return;
            }
            const revHtml = formatRevenue(Number(rev) || 0) || '—';
            const ordHtml = ord ? (formatSessions(ord) + ' orders') : '—';
            tooltip.html(
              '<div style="min-width:180px">' +
                '<div style="font-weight:600;margin-bottom:2px">' + escapeHtml(name) + '</div>' +
                '<div style="color:' + escapeHtml(muted) + ';font-size:.8125rem">Revenue: <span style=\"color:inherit\">' + escapeHtml(revHtml) + '</span></div>' +
                '<div style="color:' + escapeHtml(muted) + ';font-size:.8125rem">Orders: <span style=\"color:inherit\">' + escapeHtml(ordHtml) + '</span></div>' +
              '</div>'
            );
          }
        });
      } catch (err) {
        console.error('[countries-map] map render error:', err);
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;">Map rendering failed</div>';
      }
    }

    function renderBestGeoProducts(data) {
      const map = data && data.bestGeoProducts ? data.bestGeoProducts : {};
      const rows = map[getStatsRange()] || [];
      const tbody = document.getElementById('best-geo-products-body');
      if (!tbody) return;
      if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No data</div></div>';
        updateSortHeadersInContainer(document.getElementById('best-geo-products-table'), tableSortState.bestGeoProducts.by, tableSortState.bestGeoProducts.dir);
        updateCardPagination('best-geo-products', 1, 1);
        return;
      }
      const list = rows.slice();
      const geoBy = (tableSortState.bestGeoProducts.by || 'rev').toString().trim().toLowerCase();
      const geoDir = (tableSortState.bestGeoProducts.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      function geoCountryLabel(r) {
        const iso = (r && r.country_code != null ? String(r.country_code) : 'XX').toUpperCase().slice(0, 2);
        return countryLabel(iso);
      }
      function geoProductTitle(r) {
        return (r && r.product_title != null) ? String(r.product_title).trim() : '';
      }
      list.sort(function(a, b) {
        if (geoBy === 'country') {
          return cmpNullableText(geoCountryLabel(a), geoCountryLabel(b), geoDir) ||
            cmpNullableText(geoProductTitle(a), geoProductTitle(b), 'asc');
        }
        if (geoBy === 'cr') return cmpNullableNumber(a && a.conversion, b && b.conversion, geoDir) || cmpNullableNumber(a && a.total, b && b.total, 'desc');
        if (geoBy === 'sales') return cmpNullableNumber(a && a.converted, b && b.converted, geoDir) || cmpNullableNumber(a && a.revenue, b && b.revenue, 'desc');
        if (geoBy === 'clicks') return cmpNullableNumber(a && a.total, b && b.total, geoDir) || cmpNullableNumber(a && a.converted, b && b.converted, 'desc');
        if (geoBy === 'rev') return cmpNullableNumber(a && a.revenue, b && b.revenue, geoDir) || cmpNullableNumber(a && a.converted, b && b.converted, 'desc');
        return 0;
      });

      const geoPageSize = Math.max(1, (lastCountryRowCount || COUNTRY_PAGE_SIZE) - 1);
      const totalPages = Math.max(1, Math.ceil(list.length / geoPageSize));
      bestGeoProductsPage = clampPage(bestGeoProductsPage, totalPages);
      updateCardPagination('best-geo-products', bestGeoProductsPage, totalPages);
      const start = (bestGeoProductsPage - 1) * geoPageSize;
      const pageRows = list.slice(start, start + geoPageSize);
      tbody.innerHTML = pageRows.map(r => {
        const iso = (r.country_code || 'XX').toUpperCase().slice(0, 2);
        const label = countryLabel(iso);
        const productTitle = (r.product_title && String(r.product_title).trim()) ? String(r.product_title).trim() : '—';
        const productHandle = (r && r.product_handle != null) ? String(r.product_handle).trim() : '';
        const productThumb = (r && r.product_thumb_url != null) ? String(r.product_thumb_url).trim() : '';
        const mainBase = getMainBaseUrl();
        const productUrl = (mainBase && productHandle) ? (mainBase + '/products/' + encodeURIComponent(productHandle)) : '';
        const conversion = pct(r.conversion);
        const salesCount = r.converted != null ? Number(r.converted) : 0;
        const clicks = r.total != null ? formatSessions(r.total) : '—';
        const revenue = formatRevenueTableHtml(r.revenue);
        const flag = flagImg(iso, label);
        const titleLink = productUrl
          ? '<a href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener">' + escapeHtml(productTitle) + '</a>'
          : escapeHtml(productTitle);
        const labelHtml = '<span class="country-label">' + titleLink + '</span>';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="country-cell">' + flag + labelHtml + '</span></div>' +
          '<div class="grid-cell" role="cell">' + conversion + '</div>' +
          '<div class="grid-cell" role="cell">' + salesCount + '</div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
        '</div>';
      }).join('');
      updateSortHeadersInContainer(document.getElementById('best-geo-products-table'), geoBy, geoDir);
      scheduleBreakdownSync();
    }

    function isCustomDayRangeKey(v) {
      return typeof v === 'string' && /^d:\d{4}-\d{2}-\d{2}$/.test(v);
    }

    function isCustomRangeKey(v) {
      return typeof v === 'string' && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(v);
    }

    function ymdFromDayKey(dayKey) {
      if (!isCustomDayRangeKey(dayKey)) return null;
      return dayKey.slice(2);
    }

    function ymdRangeFromRangeKey(rangeKey) {
      if (!isCustomRangeKey(rangeKey)) return null;
      const parts = String(rangeKey).split(':');
      if (parts.length !== 3) return null;
      const a = String(parts[1] || '').trim();
      const b = String(parts[2] || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
      const startYmd = a <= b ? a : b;
      const endYmd = a <= b ? b : a;
      return { startYmd, endYmd };
    }

    function appliedYmdRangeFromDateRange() {
      if (isCustomRangeKey(dateRange)) return ymdRangeFromRangeKey(dateRange);
      if (isCustomDayRangeKey(dateRange)) {
        const ymd = ymdFromDayKey(dateRange);
        return ymd ? { startYmd: ymd, endYmd: ymd } : null;
      }
      return null;
    }

    function formatYmdLabel(ymd) {
      if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return String(ymd || '');
      const y = parseInt(String(ymd).slice(0, 4), 10);
      const m = parseInt(String(ymd).slice(5, 7), 10);
      const d = parseInt(String(ymd).slice(8, 10), 10);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return String(ymd || '');
      const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      try {
        return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(dt);
      } catch (_) {
        return String(ymd || '');
      }
    }

    function formatYmdRangeLabel(startYmd, endYmd) {
      if (!startYmd || !endYmd) return '';
      if (startYmd === endYmd) return formatYmdShort(startYmd);
      // Same month? Compact as "5–7 Feb"
      if (startYmd.slice(0, 7) === endYmd.slice(0, 7)) {
        var d1 = parseInt(startYmd.slice(8, 10), 10);
        var d2 = parseInt(endYmd.slice(8, 10), 10);
        var suffix = formatYmdShort(endYmd);
        // suffix is "7 Feb" — replace the day part
        return d1 + '–' + suffix;
      }
      return formatYmdShort(startYmd) + ' – ' + formatYmdShort(endYmd);
    }

    function formatYmdShort(ymd) {
      if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return String(ymd || '');
      var y = parseInt(String(ymd).slice(0, 4), 10);
      var m = parseInt(String(ymd).slice(5, 7), 10);
      var d = parseInt(String(ymd).slice(8, 10), 10);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return String(ymd || '');
      var dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      try {
        return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(dt);
      } catch (_) {
        return String(ymd || '');
      }
    }

    function makeRangeKeyFromYmds(startYmd, endYmd) {
      const a = String(startYmd || '').trim();
      const b = String(endYmd || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
      const s = a <= b ? a : b;
      const e = a <= b ? b : a;
      return 'r:' + s + ':' + e;
    }

    function updateLiveViewTitle() {
      const sel = document.getElementById('global-date-select');
      // Date page: sync the table card title with the selected range
      if (PAGE === 'date') {
        const titleEl = document.getElementById('table-title-text');
        if (titleEl) {
          let label = null;
          const applied = appliedYmdRangeFromDateRange();
          if (applied && applied.startYmd && applied.endYmd) {
            label = formatYmdRangeLabel(applied.startYmd, applied.endYmd);
          } else if (sel) {
            const opt = sel.querySelector('option[value="' + dateRange + '"]') || sel.options[sel.selectedIndex];
            label = opt && opt.textContent ? String(opt.textContent).trim() : null;
          }
          const fallback = { today: 'Today', yesterday: 'Yesterday', '3d': 'Last 3 Days', '7d': 'Last 7 Days', '1h': 'Last Hour', custom: 'Custom' };
          titleEl.textContent = label || fallback[dateRange] || 'Today';
        }
      }
    }

    function updateRowsPerPageVisibility() {
      const wrap = document.getElementById('rows-per-page-wrap');
      if (wrap) wrap.classList.toggle('is-hidden', dateRange === 'live');
    }

    function syncDateSelectOptions() {
      const sel = document.getElementById('global-date-select');
      if (!sel) return;
      const hasLive = sel.querySelector('option[value="live"]');
      if (hasLive) hasLive.remove();
      // Keep the "Custom" option stable, and create a dynamic option for the currently applied custom range.
      const customOpt = document.getElementById('date-opt-custom') || sel.querySelector('option[value="custom"]');
      if (customOpt) customOpt.textContent = 'Custom';

      // Remove previous dynamic custom-range option(s).
      sel.querySelectorAll('option[data-custom-range="1"]').forEach(function(o) { try { o.remove(); } catch (_) {} });

      // Normalize legacy single-day custom keys into the new range key.
      if (isCustomDayRangeKey(dateRange)) {
        const ymd = ymdFromDayKey(dateRange);
        const rk = ymd ? makeRangeKeyFromYmds(ymd, ymd) : null;
        if (rk) dateRange = rk;
      }

      const applied = appliedYmdRangeFromDateRange();
      if (applied && applied.startYmd && applied.endYmd) {
        customRangeStartYmd = applied.startYmd;
        customRangeEndYmd = applied.endYmd;
        const label = formatYmdRangeLabel(applied.startYmd, applied.endYmd) || 'Selected dates';
        const opt = document.createElement('option');
        opt.value = String(dateRange);
        opt.textContent = label;
        opt.setAttribute('data-custom-range', '1');
        if (customOpt && customOpt.parentNode === sel) sel.insertBefore(opt, customOpt);
        else sel.appendChild(opt);
        sel.value = String(dateRange);
      } else if (activeMainTab === 'spy' || activeMainTab === 'sales' || activeMainTab === 'date') {
        // Table pages: dropdown stays on Today/Yesterday/Custom.
        sel.value = (dateRange === 'live' || dateRange === 'sales' || dateRange === '1h') ? 'today' : String(dateRange || 'today');
      } else {
        // Other tabs only use day/range ranges; if somehow on live, treat as Today.
        if (dateRange === 'live') {
          dateRange = 'today';
          sessionsTotal = null;
        }
        sel.value = (dateRange === 'live' || dateRange === 'sales' || dateRange === '1h') ? 'today' : String(dateRange || 'today');
      }

      updateLiveViewTitle();
      updateRowsPerPageVisibility();
    }

    function applyRangeAvailable(available) {
      const sel = document.getElementById('global-date-select');
      if (!sel) return;
      const keys = ['today', 'yesterday'];
      const allowYesterday = floorAllowsYesterday();
      if (dateRange === 'yesterday' && !allowYesterday) {
        dateRange = 'today';
        customRangeStartYmd = null;
        customRangeEndYmd = null;
        syncDateSelectOptions();
      }
      keys.forEach((key) => {
        const o = sel.querySelector('option[value="' + key + '"]');
        if (!o) return;
        const ok = key === 'yesterday' ? (allowYesterday && !!(available && available[key])) : !!(available && available[key]);
        o.disabled = !ok;
        try { o.hidden = (key === 'yesterday' && !allowYesterday); } catch (_) {}
      });

      try {
        const menu = document.getElementById('mobile-date-menu');
        if (menu) {
          const item = menu.querySelector('.mobile-date-item[data-value="yesterday"]');
          if (item) item.style.display = allowYesterday ? '' : 'none';
        }
      } catch (_) {}
      if (dateRange !== 'live' && !isCustomDayRangeKey(dateRange) && !isCustomRangeKey(dateRange) && available && available[dateRange] === false) {
        dateRange = 'today';
        customRangeStartYmd = null;
        customRangeEndYmd = null;
        syncDateSelectOptions();
      }
      updateLiveViewTitle();
      updateRowsPerPageVisibility();
    }

    // Custom date calendar (last 30 days, disabled if no data)
    let availableDaysMemo = null;
    let availableDaysMemoAt = 0;
    let availableDaysInflight = null;
    const AVAILABLE_DAYS_MEMO_TTL_MS = 60 * 1000;

    function fetchAvailableDays(days, opts = {}) {
      const force = !!opts.force;
      const now = Date.now();
      if (!force && availableDaysMemo && (now - availableDaysMemoAt) < AVAILABLE_DAYS_MEMO_TTL_MS) {
        return Promise.resolve(availableDaysMemo);
      }
      if (!force && availableDaysInflight) return availableDaysInflight;
      const url = API + '/api/available-days?days=' + encodeURIComponent(String(days || 30)) + (force ? ('&_=' + now) : '');
      const p = fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 20000)
        .then((r) => (r && r.ok) ? r.json() : null)
        .then((data) => {
          if (data && data.ok) {
            availableDaysMemo = data;
            availableDaysMemoAt = Date.now();
          }
          return data;
        })
        .catch(() => null)
        .finally(() => {
          if (availableDaysInflight === p) availableDaysInflight = null;
        });
      availableDaysInflight = p;
      return p;
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    // Flatpickr instance for custom date picker
    let flatpickrInstance = null;
    let availableDatesSet = new Set();

    function initFlatpickrDatePicker(payload) {
      const input = document.getElementById('date-range-picker');
      if (!input) return;

      // Destroy existing instance
      if (flatpickrInstance) {
        flatpickrInstance.destroy();
        flatpickrInstance = null;
      }

      // Parse available days from API
      const data = payload && payload.ok ? payload : null;
      if (data && Array.isArray(data.days)) {
        availableDatesSet = new Set(
          data.days
            .filter(function(d) { return d && d.date && d.hasSessions; })
            .map(function(d) { return String(d.date); })
        );
      }

      // Wait for flatpickr to be available
      if (typeof flatpickr === 'undefined') {
        setTimeout(function() { initFlatpickrDatePicker(payload); }, 200);
        return;
      }

      // Initialize flatpickr
      flatpickrInstance = flatpickr(input, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        maxDate: 'today',
        minDate: MIN_YMD || '2025-02-01',
        disable: [
          function(date) {
            const y = date.getFullYear();
            const m = date.getMonth() + 1;
            const d = date.getDate();
            const ymd = y + '-' + pad2(m) + '-' + pad2(d);
            return !availableDatesSet.has(ymd);
          }
        ],
        onChange: function(selectedDates) {
          if (selectedDates.length === 0) {
            pendingCustomRangeStartYmd = null;
            pendingCustomRangeEndYmd = null;
            updateCustomDateFooter();
            return;
          }
          if (selectedDates.length === 1) {
            const d = selectedDates[0];
            const ymd = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
            pendingCustomRangeStartYmd = ymd;
            pendingCustomRangeEndYmd = null;
            updateCustomDateFooter();
            return;
          }
          if (selectedDates.length === 2) {
            const d1 = selectedDates[0];
            const d2 = selectedDates[1];
            const ymd1 = d1.getFullYear() + '-' + pad2(d1.getMonth() + 1) + '-' + pad2(d1.getDate());
            const ymd2 = d2.getFullYear() + '-' + pad2(d2.getMonth() + 1) + '-' + pad2(d2.getDate());

            // Check 30-day limit
            const diffMs = Math.abs(d2 - d1);
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            if (diffDays > 30) {
              // Exceeded limit - reset
              flatpickrInstance.clear();
              pendingCustomRangeStartYmd = null;
              pendingCustomRangeEndYmd = null;
              updateCustomDateFooter();
              const summaryEl = document.getElementById('date-custom-summary');
              if (summaryEl) summaryEl.textContent = 'Range exceeds 30 days. Please select a shorter period.';
              return;
            }

            pendingCustomRangeStartYmd = ymd1 <= ymd2 ? ymd1 : ymd2;
            pendingCustomRangeEndYmd = ymd1 <= ymd2 ? ymd2 : ymd1;
            updateCustomDateFooter();
          }
        }
      });

      // Set initial dates if already selected
      if (pendingCustomRangeStartYmd && pendingCustomRangeEndYmd) {
        flatpickrInstance.setDate([pendingCustomRangeStartYmd, pendingCustomRangeEndYmd]);
      } else if (pendingCustomRangeStartYmd) {
        flatpickrInstance.setDate(pendingCustomRangeStartYmd);
      }
    }

    function closeCustomDateModal() {
      const modal = document.getElementById('date-custom-modal');
      if (!modal) return;
      modal.style.display = '';
      modal.classList.remove('show');
      document.body.classList.remove('modal-open');
      pendingCustomRangeStartYmd = null;
      pendingCustomRangeEndYmd = null;
      if (flatpickrInstance) {
        flatpickrInstance.destroy();
        flatpickrInstance = null;
      }
      syncDateSelectOptions();
    }

    function applyDateRangeChange() {
      if (dateRange !== 'live') lastOnlineCount = null;
      countryPage = 1;
      bestGeoProductsPage = 1;
      aovPage = 1;
      bestSellersPage = 1;
      bestVariantsPage = 1;
      currentPage = 1;
      syncDateSelectOptions();
      // Reset caches when range changes.
      leaderboardCache = null;
      finishesCache = null;
      lengthsCache = null;
      chainStylesCache = null;
      bestSellersCache = null;
      bestVariantsCache = null;
      trafficCache = null;
      lastStatsFetchedAt = 0;
      lastProductsFetchedAt = 0;
      lastTrafficFetchedAt = 0;
      updateNextUpdateUi();

      // Top KPI grid refreshes independently (every minute). On range change, force a refresh immediately.
      refreshKpis({ force: true });

      if (activeMainTab === 'dashboard') {
        try { if (typeof refreshDashboard === 'function') refreshDashboard({ force: true }); } catch (_) {}
      } else if (activeMainTab === 'stats') {
        refreshStats({ force: false });
      } else if (activeMainTab === 'channels' || activeMainTab === 'type') {
        refreshTraffic({ force: false });
      } else if (activeMainTab === 'products') {
        refreshProducts({ force: false });
      } else if (activeMainTab === 'ads') {
        try { if (window.__adsRefresh) window.__adsRefresh({ force: false }); } catch (_) {}
      } else {
        updateKpis();
        fetchSessions();
      }
    }

    function openCustomDateModal() {
      const modal = document.getElementById('date-custom-modal');
      const input = document.getElementById('date-range-picker');
      if (!modal || !input) return;
      modal.style.display = 'block';
      modal.classList.add('show');
      document.body.classList.add('modal-open');
      const applied = appliedYmdRangeFromDateRange();
      pendingCustomRangeStartYmd = applied && applied.startYmd && applied.startYmd >= MIN_YMD ? applied.startYmd : null;
      pendingCustomRangeEndYmd = applied && applied.endYmd && applied.endYmd >= MIN_YMD ? applied.endYmd : null;
      customCalendarLastPayload = null;
      updateCustomDateFooter();
      input.placeholder = 'Loading...';
      input.disabled = true;
      fetchAvailableDays(30).then((payload) => {
        customCalendarLastPayload = payload;
        initFlatpickrDatePicker(payload);
        input.placeholder = 'Select dates...';
        input.disabled = false;
        updateCustomDateFooter();
      });
    }

    function updateCustomDateFooter() {
      const summaryEl = document.getElementById('date-custom-summary');
      const clearBtn = document.getElementById('date-custom-clear');
      const applyBtn = document.getElementById('date-custom-apply');
      if (!summaryEl) return;
      const a = pendingCustomRangeStartYmd;
      const b = pendingCustomRangeEndYmd;
      if (!a) {
        summaryEl.textContent = 'Select a start date.';
        if (clearBtn) clearBtn.disabled = true;
        if (applyBtn) applyBtn.disabled = true;
        return;
      }
      if (!b) {
        summaryEl.textContent = 'Start: ' + formatYmdLabel(a) + '. Select an end date.';
        if (clearBtn) clearBtn.disabled = false;
        if (applyBtn) applyBtn.disabled = true;
        return;
      }
      const startYmd = a <= b ? a : b;
      const endYmd = a <= b ? b : a;
      summaryEl.textContent = 'Selected: ' + (formatYmdRangeLabel(startYmd, endYmd) || (startYmd + ' – ' + endYmd));
      if (clearBtn) clearBtn.disabled = false;
      if (applyBtn) applyBtn.disabled = false;
    }

    let customDateModalInited = false;
    function initCustomDateModal() {
      if (customDateModalInited) return;
      customDateModalInited = true;
      const modal = document.getElementById('date-custom-modal');
      if (!modal) return;
      const closeBtn = document.getElementById('date-custom-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', function(e) { e.preventDefault(); closeCustomDateModal(); });
      modal.addEventListener('click', function(e) {
        if (e && e.target === modal) closeCustomDateModal();
      });
      document.addEventListener('keydown', function(e) {
        if (!modal.classList.contains('show')) return;
        const key = e && (e.key || e.code) ? String(e.key || e.code) : '';
        if (key === 'Escape') closeCustomDateModal();
      });
      const clearBtn = document.getElementById('date-custom-clear');
      const applyBtn = document.getElementById('date-custom-apply');
      if (clearBtn) {
        clearBtn.addEventListener('click', function(e) {
          e.preventDefault();
          pendingCustomRangeStartYmd = null;
          pendingCustomRangeEndYmd = null;
          if (flatpickrInstance) flatpickrInstance.clear();
          updateCustomDateFooter();
        });
      }
      if (applyBtn) {
        applyBtn.addEventListener('click', function(e) {
          e.preventDefault();
          const a = pendingCustomRangeStartYmd;
          const b = pendingCustomRangeEndYmd;
          if (!a || !b) return;
          const startYmd = a <= b ? a : b;
          const endYmd = a <= b ? b : a;
          if (startYmd < MIN_YMD || endYmd < MIN_YMD) return;
          const rk = makeRangeKeyFromYmds(startYmd, endYmd);
          if (!rk) return;
          customRangeStartYmd = startYmd;
          customRangeEndYmd = endYmd;
          dateRange = rk;
          closeCustomDateModal();
          applyDateRangeChange();
        });
      }
      // Flatpickr handles date selection via its own UI
    }

    function maybeTriggerSaleToastFromStatsLikeData(data) {
      const conv = data && data.convertedCount ? data.convertedCount : {};
      const haveToday = (typeof conv.today === 'number' && Number.isFinite(conv.today));
      if (!haveToday) return;

      // Reset the converted-count baseline daily (admin TZ).
      try {
        const day = ymdNowInTz();
        if (convertedCountDayYmd == null) convertedCountDayYmd = day;
        if (day && convertedCountDayYmd !== day) {
          convertedCountDayYmd = day;
          hasSeenConvertedCountToday = false;
          lastConvertedCountToday = 0;
        }
      } catch (_) {}

      // Guard against stale/cache drift where counts briefly move backwards (would cause double "sale" sounds).
      if (hasSeenConvertedCountToday && conv.today < lastConvertedCountToday) return;

      const increased = hasSeenConvertedCountToday && conv.today > lastConvertedCountToday;
      if (increased) {
        triggerSaleToast({ origin: 'stats', playSound: true });
        // Keep Home tables in sync when a toast fires outside SSE (Today/Sales/Live).
        if (activeMainTab === 'spy' && (dateRange === 'today' || dateRange === 'sales' || dateRange === 'live' || dateRange === '1h')) {
          try { fetchSessions(); } catch (_) {}
        }
        // Pull the authoritative timestamp (truth/evidence) so the footer is accurate.
        // Don't refresh Diagnostics in the background while the modal is open (avoid disrupting viewing).
        try {
          if (!(typeof isConfigModalOpen === 'function' && isConfigModalOpen())) {
            refreshConfigStatus();
          }
        } catch (_) {}
      }
      lastConvertedCountToday = conv.today;
      hasSeenConvertedCountToday = true;
    }

    function setLiveKpisLoading() {
      const spinner = '<span class="kpi-mini-spinner" aria-hidden="true"></span>';
      const ids = ['live-kpi-sales', 'live-kpi-sessions', 'live-kpi-conv', 'live-kpi-returning', 'live-kpi-aov', 'live-kpi-bounce'];
      ids.forEach(function(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.removeAttribute('data-odometer');
        el.innerHTML = spinner;
      });
    }

    function renderStats(data) {
      statsCache = data || {};
      const statsRange = getStatsRange();
      if (statsRange !== 'today') {
        if (kpiCache && kpiCache.compare && !statsCache.compare) {
          kpiCache = { ...statsCache, compare: kpiCache.compare };
        } else {
          kpiCache = statsCache;
        }
      }
      maybeTriggerSaleToastFromStatsLikeData(statsCache);
      if (statsCache.rangeAvailable) applyRangeAvailable(statsCache.rangeAvailable);
      renderCountriesPieChart(statsCache);
      renderCountriesMapChart(statsCache);
      renderCountry(statsCache);
      renderBestGeoProducts(statsCache);
      renderAov(statsCache);
      renderLiveKpis(getKpiData());
      scheduleBreakdownSync();
    }

    function kpiDelta(current, baseline) {
      const cur = typeof current === 'number' ? current : NaN;
      const base = typeof baseline === 'number' ? baseline : NaN;
      if (!Number.isFinite(cur) || !Number.isFinite(base)) return null;
      const diff = cur - base;
      if (diff === 0) return 0;
      if (base <= 0) return diff > 0 ? 1 : -1;
      return diff / base;
    }

    function applyKpiDeltaColor(el, current, baseline, invert) {
      if (!el) return;
      var wrapper = el.closest('.d-flex.align-items-baseline');
      if (wrapper) {
        var old = wrapper.querySelector('.kpi-delta-indicator');
        if (old) old.remove();
      }
      const delta = kpiDelta(current, baseline);
      if (delta == null) return;
      if (Math.abs(delta) < 0.005) return;
      const pct = Math.round(Math.abs(delta) * 100);
      const toneDelta = invert ? -delta : delta;
      const colorClass = toneDelta > 0 ? 'text-green' : 'text-red';
      const iconClass = delta > 0 ? 'ti ti-trending-up' : 'ti ti-trending-down';
      var indicator = document.createElement('div');
      indicator.className = 'kpi-delta-indicator me-auto ' + colorClass;
      indicator.setAttribute('aria-hidden', 'true');
      indicator.innerHTML = '<i class="' + iconClass + '"></i> ' + pct + '%';
      if (wrapper) {
        wrapper.appendChild(indicator);
      }
    }

    const kpiSparklines = {};

    function renderKpiSparkline(kpiKey, dataPoints) {
      const el = document.getElementById('kpi-sparkline-' + kpiKey);
      if (!el) return;

      if (kpiSparklines[kpiKey]) {
        try { kpiSparklines[kpiKey].destroy(); } catch (_) {}
        kpiSparklines[kpiKey] = null;
      }

      if (typeof ApexCharts === 'undefined') {
        setTimeout(function() { renderKpiSparkline(kpiKey, dataPoints); }, 200);
        return;
      }

      const data = Array.isArray(dataPoints) ? dataPoints.slice(-7) : [];
      if (data.length === 0) return;

      const primaryRgb = getComputedStyle(document.documentElement).getPropertyValue('--tblr-primary-rgb').trim() || '32,107,196';

      el.innerHTML = '';
      kpiSparklines[kpiKey] = new ApexCharts(el, {
        chart: { type: 'area', sparkline: { enabled: true }, animations: { enabled: true, easing: 'easeinout', speed: 300 } },
        series: [{ data: data }],
        stroke: { width: 2, curve: 'smooth' },
        fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0.01 } },
        colors: ['rgba(' + primaryRgb + ', 0.6)'],
        tooltip: { enabled: false }
      });
      kpiSparklines[kpiKey].render();
    }

    var sparklineSeriesCache = null;
    var sparklineSeriesFetched = false;

    function fetchSparklineData() {
      if (sparklineSeriesFetched || PAGE === 'dashboard') return;
      sparklineSeriesFetched = true;
      var url = API + '/api/dashboard-series?days=14';
      fetchWithTimeout(url, { credentials: 'same-origin' }, 15000)
        .then(function(r) { return (r && r.ok) ? r.json() : null; })
        .then(function(data) {
          if (data && Array.isArray(data.series) && data.series.length > 0) {
            sparklineSeriesCache = data.series.slice(-7);
            renderSparklineFromCache();
          }
        })
        .catch(function() {});
    }

    function renderSparklineFromCache() {
      if (!sparklineSeriesCache || sparklineSeriesCache.length < 2) return;
      var s = sparklineSeriesCache;
      renderKpiSparkline('sales', s.map(function(d) { return d.revenue || 0; }));
      renderKpiSparkline('conv', s.map(function(d) { return d.convRate || 0; }));
      renderKpiSparkline('sessions', s.map(function(d) { return d.sessions || 0; }));
      renderKpiSparkline('returning', s.map(function(d) { return d.returningCustomerOrders || 0; }));
      renderKpiSparkline('aov', s.map(function(d) { return d.aov || 0; }));
      renderKpiSparkline('bounce', s.map(function(d) { return d.bounceRate || 0; }));
    }

    function renderLiveKpis(data) {
      const salesEl = document.getElementById('live-kpi-sales');
      const sessionsEl = document.getElementById('live-kpi-sessions');
      const convEl = document.getElementById('live-kpi-conv');
      const returningEl = document.getElementById('live-kpi-returning');
      const aovEl = document.getElementById('live-kpi-aov');
      const bounceEl = document.getElementById('live-kpi-bounce');
      const salesSubEl = document.getElementById('live-kpi-sales-sub');
      const sessionsSubEl = document.getElementById('live-kpi-sessions-sub');
      const convSubEl = document.getElementById('live-kpi-conv-sub');
      const returningSubEl = document.getElementById('live-kpi-returning-sub');
      const aovSubEl = document.getElementById('live-kpi-aov-sub');
      const bounceSubEl = document.getElementById('live-kpi-bounce-sub');
      const salesLabelEl = document.getElementById('live-kpi-sales-label');
      const sales = data && data.sales ? data.sales : {};
      const convertedCountMap = data && data.convertedCount ? data.convertedCount : {};
      const returningRevenue = data && data.returningRevenue ? data.returningRevenue : {};
      const breakdown = data && data.trafficBreakdown ? data.trafficBreakdown : {};
      const conv = data && data.conversion ? data.conversion : {};
      const aovMap = data && data.aov ? data.aov : {};
      const bounceMap = data && data.bounce ? data.bounce : {};
      const kpiRange = getStatsRange();
      const forRange = breakdown[kpiRange];
      const sessionsVal = forRange != null && typeof forRange.human_sessions === 'number' ? forRange.human_sessions : null;
      const salesVal = typeof sales[kpiRange] === 'number' ? sales[kpiRange] : null;
      const orderCountVal = typeof convertedCountMap[kpiRange] === 'number' ? convertedCountMap[kpiRange] : null;
      const returningVal = typeof returningRevenue[kpiRange] === 'number' ? returningRevenue[kpiRange] : null;
      const convVal = typeof conv[kpiRange] === 'number' ? conv[kpiRange] : null;
      const aovVal = typeof aovMap[kpiRange] === 'number' ? aovMap[kpiRange] : null;
      const bounceVal = typeof bounceMap[kpiRange] === 'number' ? bounceMap[kpiRange] : null;
      const compare = data && data.compare ? data.compare : null;
      const compareBreakdown = compare && compare.trafficBreakdown ? compare.trafficBreakdown : null;
      const compareSessionsVal = compareBreakdown && typeof compareBreakdown.human_sessions === 'number' ? compareBreakdown.human_sessions : null;
      const compareSalesVal = compare && typeof compare.sales === 'number' ? compare.sales : null;
      const compareReturningVal = compare && typeof compare.returningRevenue === 'number' ? compare.returningRevenue : null;
      const compareConvVal = compare && typeof compare.conversion === 'number' ? compare.conversion : null;
      const compareAovVal = compare && typeof compare.aov === 'number' ? compare.aov : null;
      const compareBounceVal = compare && typeof compare.bounce === 'number' ? compare.bounce : null;

      if (salesLabelEl) {
        salesLabelEl.textContent = orderCountVal != null ? (Math.round(orderCountVal) + ' Orders') : 'Orders';
        salesLabelEl.title = '';
      }
      if (salesEl) {
        salesEl.textContent = salesVal != null ? formatRevenue(salesVal) : '\u2014';
      }
      if (sessionsEl) sessionsEl.textContent = sessionsVal != null ? formatSessions(sessionsVal) : '\u2014';
      if (convEl) convEl.textContent = convVal != null ? pct(convVal) : '\u2014';
      if (returningEl) returningEl.textContent = returningVal != null ? formatRevenue(returningVal) : '\u2014';
      if (aovEl) aovEl.textContent = aovVal != null ? formatRevenue(aovVal) : '\u2014';
      if (bounceEl) bounceEl.textContent = bounceVal != null ? pct(bounceVal) : '\u2014';

      applyKpiDeltaColor(salesEl, salesVal, compareSalesVal, false);
      applyKpiDeltaColor(sessionsEl, sessionsVal, compareSessionsVal, false);
      applyKpiDeltaColor(convEl, convVal, compareConvVal, false);
      applyKpiDeltaColor(returningEl, returningVal, compareReturningVal, false);
      applyKpiDeltaColor(aovEl, aovVal, compareAovVal, false);
      applyKpiDeltaColor(bounceEl, bounceVal, compareBounceVal, true);

      // Render sparklines from real dashboard-series data
      if (!sparklineSeriesFetched) fetchSparklineData();
      else renderSparklineFromCache();

      function setSub(el, text) {
        if (!el) return;
        if (text === '' || text == null) {
          el.textContent = '';
          el.classList.add('is-hidden');
          return;
        }
        const compareSvg =
          '<svg width="13" height="13" fill="currentColor" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
            '<path d="M46.05,60.163H31.923c-0.836,0-1.513,0.677-1.513,1.513v21.934c0,0.836,0.677,1.513,1.513,1.513H46.05 c0.836,0,1.512-0.677,1.512-1.513V61.675C47.562,60.839,46.885,60.163,46.05,60.163z"></path>' +
            '<path d="M68.077,14.878H53.95c-0.836,0-1.513,0.677-1.513,1.513v67.218c0,0.836,0.677,1.513,1.513,1.513h14.127 c0.836,0,1.513-0.677,1.513-1.513V16.391C69.59,15.555,68.913,14.878,68.077,14.878z"></path>' +
            '<path d="M90.217,35.299H76.09c-0.836,0-1.513,0.677-1.513,1.513v46.797c0,0.836,0.677,1.513,1.513,1.513h14.126 c0.836,0,1.513-0.677,1.513-1.513V36.812C91.729,35.977,91.052,35.299,90.217,35.299z"></path>' +
            '<path d="M23.91,35.299H9.783c-0.836,0-1.513,0.677-1.513,1.513v46.797c0,0.836,0.677,1.513,1.513,1.513H23.91 c0.836,0,1.513-0.677,1.513-1.513V36.812C25.423,35.977,24.746,35.299,23.91,35.299z"></path>' +
          '</svg>';

        function compareBtn(kpiKey, ariaLabel) {
          return (
            '<button type="button" class="kpi-compare-inline-btn kpi-compare-open-btn" data-kpi-compare="' + escapeHtml(kpiKey) + '"' +
              ' aria-label="' + escapeHtml(ariaLabel) + '" title="Compare vs Shopify">' +
              compareSvg +
            '</button>'
          );
        }

        if (el === convSubEl) {
          el.innerHTML = compareBtn('conv', 'Compare conversion rate vs Shopify') + escapeHtml(text == null ? '' : String(text));
        } else if (el === sessionsSubEl) {
          el.innerHTML = compareBtn('sessions', 'Compare sessions vs Shopify') + escapeHtml(text == null ? '' : String(text));
        } else if (el === aovSubEl) {
          el.innerHTML = compareBtn('aov', 'Compare AOV vs Shopify') + escapeHtml(text == null ? '' : String(text));
        } else {
          el.textContent = text;
        }
        el.classList.remove('is-hidden');
      }
      setSub(salesSubEl, compareSalesVal != null ? formatRevenueSub(compareSalesVal) : '\u2014');
      setSub(sessionsSubEl, compareSessionsVal != null ? formatSessions(compareSessionsVal) : '\u2014');
      setSub(convSubEl, compareConvVal != null ? pct(compareConvVal) : '\u2014');
      setSub(returningSubEl, compareReturningVal != null ? formatRevenueSub(compareReturningVal) : '\u2014');
      setSub(aovSubEl, compareAovVal != null ? formatRevenueSub(compareAovVal) : '\u2014');
      setSub(bounceSubEl, compareBounceVal != null ? pct(compareBounceVal) : '\u2014');
      scheduleKpiPagerUpdate();
    }

    // Populate dashboard KPI cards using the same /api/kpis data as inner pages
    function renderDashboardKpisFromApi(data) {
      if (!data || PAGE !== 'dashboard') return;
      var el = function(id) { return document.getElementById(id); };
      var kpiRange = getStatsRange();
      var sales = data.sales || {};
      var convertedCountMap = data.convertedCount || {};
      var returningRevenue = data.returningRevenue || {};
      var returningOrderCountMap = data.returningOrderCount || {};
      var breakdown = data.trafficBreakdown || {};
      var conv = data.conversion || {};
      var aovMap = data.aov || {};
      var bounceMap = data.bounce || {};
      var forRange = breakdown[kpiRange];
      var sessionsVal = forRange != null && typeof forRange.human_sessions === 'number' ? forRange.human_sessions : null;
      var salesVal = typeof sales[kpiRange] === 'number' ? sales[kpiRange] : null;
      var orderCountVal = typeof convertedCountMap[kpiRange] === 'number' ? convertedCountMap[kpiRange] : null;
      var returningVal = typeof returningRevenue[kpiRange] === 'number' ? returningRevenue[kpiRange] : null;
      var returningOrdersVal = typeof returningOrderCountMap[kpiRange] === 'number' ? returningOrderCountMap[kpiRange] : null;
      var convVal = typeof conv[kpiRange] === 'number' ? conv[kpiRange] : null;
      var aovVal = typeof aovMap[kpiRange] === 'number' ? aovMap[kpiRange] : null;
      var bounceVal = typeof bounceMap[kpiRange] === 'number' ? bounceMap[kpiRange] : null;

      // Compare values
      var compare = data.compare || null;
      var compareBreakdown = compare && compare.trafficBreakdown ? compare.trafficBreakdown : null;
      var compareSessionsVal = compareBreakdown && typeof compareBreakdown.human_sessions === 'number' ? compareBreakdown.human_sessions : null;
      var compareSalesVal = compare && typeof compare.sales === 'number' ? compare.sales : null;
      var compareConvVal = compare && typeof compare.conversion === 'number' ? compare.conversion : null;
      var compareAovVal = compare && typeof compare.aov === 'number' ? compare.aov : null;
      var compareBounceVal = compare && typeof compare.bounce === 'number' ? compare.bounce : null;
      var compareReturningVal = compare && typeof compare.returningRevenue === 'number' ? compare.returningRevenue : null;
      var compareOrdersVal = compare && typeof compare.convertedCount === 'number' ? compare.convertedCount : null;
      var compareReturningOrdersVal = compare && typeof compare.returningOrderCount === 'number' ? compare.returningOrderCount : null;

      // Populate main values
      if (el('dash-kpi-revenue')) el('dash-kpi-revenue').textContent = salesVal != null ? formatRevenue(salesVal) : '\u2014';
      if (el('dash-kpi-orders')) el('dash-kpi-orders').textContent = orderCountVal != null ? Math.round(orderCountVal).toLocaleString() : '\u2014';
      if (el('dash-kpi-sessions')) el('dash-kpi-sessions').textContent = sessionsVal != null ? formatSessions(sessionsVal) : '\u2014';
      if (el('dash-kpi-conv')) el('dash-kpi-conv').textContent = convVal != null ? pct(convVal) : '\u2014';
      if (el('dash-kpi-aov')) el('dash-kpi-aov').textContent = aovVal != null ? formatRevenue(aovVal) : '\u2014';
      if (el('dash-kpi-bounce')) el('dash-kpi-bounce').textContent = bounceVal != null ? pct(bounceVal) : '\u2014';
      if (el('dash-kpi-returning')) {
        // Returning Customers rate (orders by returning customers / total orders)
        var retPct = orderCountVal > 0 && returningOrdersVal != null ? Math.round((returningOrdersVal / orderCountVal) * 1000) / 10 : null;
        el('dash-kpi-returning').textContent = retPct != null ? pct(retPct) : '\u2014';
      }

      // Change badges using same delta logic
      function changeBadge(curr, prev, invert) {
        var d = kpiDelta(curr, prev);
        if (d == null) return '<span class="text-muted">\u2014</span>';
        var p = Math.round(d * 100);
        var sign = p >= 0 ? '+' : '';
        var good = invert ? (p <= 0) : (p >= 0);
        var cls = good ? 'text-green' : 'text-red';
        var icon = p >= 0 ? '<i class="ti ti-trending-up"></i>' : '<i class="ti ti-trending-down"></i>';
        return '<span class="d-inline-flex align-items-center ' + cls + '">' + icon + ' ' + sign + p + '%</span>';
      }
      if (el('dash-kpi-revenue-change')) el('dash-kpi-revenue-change').innerHTML = changeBadge(salesVal, compareSalesVal);
      if (el('dash-kpi-orders-change')) el('dash-kpi-orders-change').innerHTML = changeBadge(orderCountVal, compareOrdersVal);
      if (el('dash-kpi-conv-change')) el('dash-kpi-conv-change').innerHTML = changeBadge(convVal, compareConvVal);
      if (el('dash-kpi-aov-change')) el('dash-kpi-aov-change').innerHTML = changeBadge(aovVal, compareAovVal);
      if (el('dash-kpi-bounce-change')) el('dash-kpi-bounce-change').innerHTML = changeBadge(bounceVal, compareBounceVal, true);
      if (el('dash-kpi-returning-change')) {
        var compareRetPct = compareOrdersVal > 0 && compareReturningOrdersVal != null
          ? Math.round((compareReturningOrdersVal / compareOrdersVal) * 1000) / 10
          : null;
        var currRetPct = orderCountVal > 0 && returningOrdersVal != null
          ? Math.round((returningOrdersVal / orderCountVal) * 1000) / 10
          : null;
        el('dash-kpi-returning-change').innerHTML = changeBadge(currRetPct, compareRetPct);
      }
    }

    // KPI pager: swipe on mobile, page on desktop when labels wrap.
    let kpiPagerRaf = null;
    function scheduleKpiPagerUpdate() {
      if (typeof requestAnimationFrame !== 'function') {
        applyKpiPager();
        return;
      }
      if (kpiPagerRaf) cancelAnimationFrame(kpiPagerRaf);
      kpiPagerRaf = requestAnimationFrame(function() {
        kpiPagerRaf = null;
        applyKpiPager();
      });
    }
    function kpiLabelWraps(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      const lh = style ? parseFloat(style.lineHeight) : 0;
      const fs = style ? parseFloat(style.fontSize) : 0;
      const lineHeight = (Number.isFinite(lh) && lh > 0) ? lh : (Number.isFinite(fs) && fs > 0 ? fs * 1.2 : 0);
      if (!lineHeight) return false;
      return rect.height > lineHeight * 1.4;
    }
    function applyKpiPager() {
      const grid = document.getElementById('live-kpi-grid');
      const btn = document.getElementById('kpi-mobile-next');
      const wrap = document.querySelector('.kpi-mobile-pager');
      if (!grid || !btn) return;
      const isMobile = !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
      if (isMobile) {
        btn.classList.add('is-hidden');
        btn.disabled = true;
        if (wrap) wrap.classList.remove('kpi-pager-active');
        return;
      }
      const hasOverflow = wrap && wrap.scrollWidth > wrap.clientWidth;
      btn.classList.toggle('is-hidden', !hasOverflow);
      btn.disabled = !hasOverflow;
      btn.setAttribute('aria-label', hasOverflow ? 'Scroll KPIs right' : 'KPIs');
      if (wrap) {
        if (hasOverflow) wrap.classList.add('kpi-pager-active');
        else wrap.classList.remove('kpi-pager-active');
      }
    }
    (function initKpiPager() {
      const btn = document.getElementById('kpi-mobile-next');
      const wrap = document.querySelector('.kpi-mobile-pager');
      if (btn && wrap) {
        btn.addEventListener('click', function() {
          if (wrap.scrollWidth > wrap.clientWidth) {
            wrap.scrollLeft += Math.min(wrap.clientWidth * 0.75, wrap.scrollWidth - wrap.scrollLeft - wrap.clientWidth);
          }
        });
      }
      scheduleKpiPagerUpdate();
      window.addEventListener('resize', function() { scheduleKpiPagerUpdate(); scheduleBreakdownSync(); });
    })();

    function delay(ms) {
      const n = Number(ms) || 0;
      if (n <= 0) return Promise.resolve();
      return new Promise(function(resolve) { setTimeout(resolve, n); });
    }

    function fetchWithTimeout(url, options, timeoutMs) {
      const ms = Number(timeoutMs) || 0;
      const timeout = ms > 0 ? ms : 25000;
      if (typeof AbortController === 'undefined') {
        return Promise.race([
          fetch(url, options),
          new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error('Request timed out')); }, timeout);
          }),
        ]);
      }
      const controller = new AbortController();
      const timer = setTimeout(function() { try { controller.abort(); } catch (_) {} }, timeout);
      const opts = Object.assign({}, options || {}, { signal: controller.signal });
      return fetch(url, opts).finally(function() { clearTimeout(timer); });
    }

    function startReportBuild(opts) {
      opts = opts && typeof opts === 'object' ? opts : {};
      const key = opts.key ? String(opts.key) : '';
      if (!key || !reportBuildTokens || typeof reportBuildTokens[key] !== 'number') {
        return { step: function() {}, finish: function() {} };
      }

      reportBuildTokens[key] = (reportBuildTokens[key] || 0) + 1;
      const token = reportBuildTokens[key];
      const overlayId = opts.overlayId ? String(opts.overlayId) : '';
      const stepId = opts.stepId ? String(opts.stepId) : '';
      const overlay = overlayId ? document.getElementById(overlayId) : null;
      const wrap = overlay ? overlay.parentElement : null;
      const stepEl = stepId ? document.getElementById(stepId) : null;

      if (wrap) wrap.classList.add('report-building');
      if (overlay) overlay.classList.remove('is-hidden');
      if (stepEl) stepEl.textContent = '';
      showPageProgress();

      function step(text) {
        if (reportBuildTokens[key] !== token) return;
        if (!stepEl) return;
        stepEl.textContent = text != null ? String(text) : '';
      }

      function finish() {
        if (reportBuildTokens[key] !== token) return;
        if (overlay) overlay.classList.add('is-hidden');
        if (wrap) wrap.classList.remove('report-building');
        hidePageProgress();
      }

      return { step: step, finish: finish };
    }

    function fetchStatsData(options = {}) {
      const force = !!options.force;
      let url = API + '/api/stats?range=' + encodeURIComponent(getStatsRange());
      if (force) url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const cacheMode = force ? 'no-store' : 'default';
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: cacheMode }, 30000)
        .then(function(r) {
          if (!r.ok) throw new Error('Stats HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          lastStatsFetchedAt = Date.now();
          lastUpdateTime = new Date();
          updateServerTimeDisplay();
          renderStats(data && typeof data.country === 'object' ? data : {});
          return data;
        })
        .catch(function(err) {
          console.error(err);
          renderStats(statsCache || {});
          return null;
        });
    }

    const KPI_REFRESH_MS = 60000;
    const KPI_SPINNER_MIN_MS = 800;
    let kpisSpinnerShownOnce = false;

    function fetchKpisData(options = {}) {
      const force = !!options.force;
      let url = API + '/api/kpis?range=' + encodeURIComponent(getStatsRange());
      if (force) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'force=1';
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 25000)
        .then(function(r) {
          if (!r.ok) throw new Error('KPIs HTTP ' + r.status);
          return r.json();
        });
    }

    function refreshKpis(options = {}) {
      const force = !!options.force;
      if (kpisRefreshInFlight) return kpisRefreshInFlight;

      // Only show the KPI mini spinners on the very first load (avoid visual noise on minute refreshes).
      const showSpinner = !kpisSpinnerShownOnce;
      if (showSpinner) {
        kpisSpinnerShownOnce = true;
        setLiveKpisLoading();
      }

      const fetchP = fetchKpisData({ force });
      kpisRefreshInFlight = (showSpinner ? Promise.all([fetchP, delay(KPI_SPINNER_MIN_MS)]) : fetchP)
        .then(function(partsOrData) {
          const data = showSpinner
            ? (partsOrData && partsOrData[0] && typeof partsOrData[0] === 'object' ? partsOrData[0] : null)
            : (partsOrData && typeof partsOrData === 'object' ? partsOrData : null);
          lastKpisFetchedAt = Date.now();
          if (data) {
            kpiCache = data;
            maybeTriggerSaleToastFromStatsLikeData(kpiCache);
          }
          renderLiveKpis(getKpiData());
          return data;
        })
        .catch(function(err) {
          console.error(err);
          renderLiveKpis(getKpiData());
          return null;
        })
        .finally(function() {
          kpisRefreshInFlight = null;
        });
      return kpisRefreshInFlight;
    }

    function refreshStats(options = {}) {
      const force = !!options.force;
      if (statsRefreshInFlight) return statsRefreshInFlight;

      const build = startReportBuild({ key: 'stats', overlayId: 'stats-loading-overlay', stepId: 'stats-build-step' });
      build.step('building countries...');
      statsRefreshInFlight = fetchStatsData({ force })
        .then(function(data) {
          build.step('building countries... done');
          return delay(180).then(function() {
            build.step('building average order...');
            return delay(120).then(function() {
              build.step('building average order... done');
              return delay(180).then(function() { return data; });
            });
          });
        })
        .finally(function() {
          statsRefreshInFlight = null;
          build.finish();
        });
      return statsRefreshInFlight;
    }

    function refreshProducts(options = {}) {
      const force = !!options.force;
      if (productsRefreshInFlight) return productsRefreshInFlight;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) return Promise.resolve(null);

      const build = startReportBuild({ key: 'products', overlayId: 'products-loading-overlay', stepId: 'products-build-step' });
      let bestP = null;
      let variantsP = null;
      let leaderboardP = null;
      let variantCardsP = null;
      try { bestP = fetchBestSellers({ force }); } catch (err) { console.error(err); bestP = Promise.resolve(null); }
      try { variantsP = fetchBestVariants({ force }); } catch (err) { console.error(err); variantsP = Promise.resolve(null); }
      try { leaderboardP = fetchProductsLeaderboard({ force }); } catch (err) { console.error(err); leaderboardP = Promise.resolve(null); }
      try {
        variantCardsP = (normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths')
          ? fetchLengths({ force })
          : fetchFinishes({ force });
      } catch (err) {
        console.error(err);
        variantCardsP = Promise.resolve(null);
      }
      function settled(p) {
        return Promise.resolve(p)
          .then(function(v) { return { ok: true, value: v }; })
          .catch(function(err) { console.error(err); return { ok: false, error: err }; });
      }
      const bestS = settled(bestP);
      const variantsS = settled(variantsP);
      const leaderboardS = settled(leaderboardP);
      const variantCardsS = settled(variantCardsP);

      productsRefreshInFlight = Promise.resolve()
        .then(function() { build.step('building best products...'); return bestS; })
        .then(function() { build.step('building best products... done'); return delay(180); })
        .then(function() { build.step('building best variants...'); return variantsS; })
        .then(function() { build.step('building best variants... done'); return delay(180); })
        .then(function() { build.step('building leaderboard...'); return leaderboardS; })
        .then(function() { build.step('building leaderboard... done'); return delay(140); })
        .then(function() { build.step('building variants...'); return variantCardsS; })
        .then(function() { build.step('building variants... done'); return delay(140); })
        .then(function() { lastProductsFetchedAt = Date.now(); })
        .catch(function(err) {
          console.error(err);
          return null;
        })
        .finally(function() {
          productsRefreshInFlight = null;
          build.finish();
        });
      return productsRefreshInFlight;
    }

    function renderTrafficTables(data) {
      const sources = data && data.sources ? data.sources : null;
      const types = data && data.types ? data.types : null;
      const srcBy = (tableSortState.trafficSources.by || 'rev').toString().trim().toLowerCase();
      const srcDir = (tableSortState.trafficSources.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      const typeBy = (tableSortState.trafficTypes.by || 'rev').toString().trim().toLowerCase();
      const typeDir = (tableSortState.trafficTypes.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';

      function trafficSourceIconHtml(keyRaw, labelRaw) {
        function icon(src, alt, title, extraClass) {
          const cls = (extraClass ? (extraClass + ' ') : '') + 'source-icon-img';
          const t = title ? ' title="' + escapeHtml(String(title)) + '"' : '';
          return '<img src="' + escapeHtml(hotImg(src) || src || '') + '" alt="' + escapeHtml(alt || '') + '" class="' + cls + '" width="20" height="20"' + t + '>';
        }
        const key = keyRaw != null ? String(keyRaw).trim().toLowerCase() : '';
        const label = labelRaw != null ? String(labelRaw).trim() : '';
        if (!key) return escapeHtml(label || '—');
        const resolvedLabel = trafficSourceLabelForKey(key, label || key);
        const customIcon = trafficSourceIconUrlForKey(key);
        const src = customIcon || trafficSourceBuiltInIconSrc(key) || SOURCE_UNKNOWN_IMG;
        const extra = key === 'google_ads' ? 'source-googleads-img' : '';
        // Traffic tab: show icon + label (Home table is icon-only).
        return '<span class="traffic-source-cell">' +
          '<span class="source-icons">' + icon(src, resolvedLabel, resolvedLabel, extra) + '</span>' +
          '<span class="traffic-source-label">' + escapeHtml(resolvedLabel || label || key) + '</span>' +
        '</span>';
      }

      function renderRows(bodyId, rows, emptyText) {
        const body = document.getElementById(bodyId);
        if (!body) return;
        const list = Array.isArray(rows) ? rows.slice() : [];
        function sourceLabel(r) {
          const key = (r && r.key != null) ? String(r.key).trim().toLowerCase() : '';
          const labelText = (r && r.label) ? String(r.label) : (key || '—');
          return labelText;
        }
        list.sort(function(a, b) {
          var primary = 0;
          if (srcBy === 'source') primary = cmpNullableText(sourceLabel(a), sourceLabel(b), srcDir);
          else if (srcBy === 'cr') primary = cmpNullableNumber(a && a.conversionPct, b && b.conversionPct, srcDir);
          else if (srcBy === 'orders') primary = cmpNullableNumber(a && a.orders, b && b.orders, srcDir);
          else if (srcBy === 'sessions') primary = cmpNullableNumber(a && a.sessions, b && b.sessions, srcDir);
          else if (srcBy === 'rev') primary = cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, srcDir);
          return primary ||
            cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
            cmpNullableNumber(a && a.orders, b && b.orders, 'desc') ||
            cmpNullableNumber(a && a.sessions, b && b.sessions, 'desc') ||
            cmpNullableText(sourceLabel(a), sourceLabel(b), 'asc');
        });
        if (!list.length) {
          body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml(emptyText || '—') + '</div></div>';
          return;
        }
        var filtered = list.filter(function(r) {
          var s = (r && typeof r.sessions === 'number') ? r.sessions : 0;
          var o = (r && typeof r.orders === 'number') ? r.orders : 0;
          return s >= 1 || o >= 1;
        });
        if (!filtered.length) {
          body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml(emptyText || '—') + '</div></div>';
          return;
        }
        let html = '';
        filtered.forEach(function(r) {
          const key = (r && r.key != null) ? String(r.key).trim().toLowerCase() : '';
          const labelText = (r && r.label) ? String(r.label) : (key || '—');
          const labelCell = trafficSourceIconHtml(key, labelText);
          const cr = (r && typeof r.conversionPct === 'number') ? pct(r.conversionPct) : '—';
          const orders = (r && typeof r.orders === 'number') ? formatSessions(r.orders) : '—';
          const sessions = (r && typeof r.sessions === 'number') ? formatSessions(r.sessions) : '—';
          const rev = (r && typeof r.revenueGbp === 'number') ? formatRevenueTableHtml(r.revenueGbp) : '—';
          html += '<div class="grid-row" role="row">' +
            '<div class="grid-cell" role="cell">' + labelCell + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(cr || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(orders || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(sessions || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + (rev || '—') + '</div>' +
            '</div>';
        });
        body.innerHTML = html;
      }

      renderRows('traffic-sources-body', sources ? sources.rows : [], 'Open Settings (footer) → Traffic to choose channels.');

      function trafficTypeDeviceIcon(device) {
        var d = (device || '').trim().toLowerCase();
        var s = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
        if (d === 'desktop') return '<svg ' + s + '><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
        if (d === 'mobile') return '<svg ' + s + '><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>';
        if (d === 'tablet') return '<svg ' + s + '><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>';
        return '<svg ' + s + '><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
      }

      function trafficTypePlatformIcon(platform) {
        var p = (platform || '').trim().toLowerCase();
        if (p === 'ios' || p === 'mac') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>';
        if (p === 'android') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.27-.86-.31-.16-.69-.04-.86.27l-1.87 3.23C14.83 8.34 13.45 8.01 12 8.01s-2.83.33-4.44.93L5.69 5.71c-.16-.31-.54-.43-.86-.27-.31.16-.43.55-.27.86l1.84 3.18C3.39 11.13 1.43 14.08 1 17.5h22c-.43-3.42-2.39-6.37-5.4-8.02zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/></svg>';
        if (p === 'windows') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 12V6.5l8-1.1V12H3zm0 .5h8v6.6l-8-1.1V12.5zm9 0h9V21l-9-1.2V12.5zm0-.5V4l9-1.2V12h-9z"/></svg>';
        if (p === 'linux') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 2C10 2 8.2 4.1 8.2 6.6c0 1.4.5 2.6.9 3.8.4 1.2.6 2.3.4 3-.5 1.2-2 2-2.4 3.3-.2.7-.1 1.5.5 2.1.7.7 1.6.6 2.2.4.6-.2 1.1-.5 1.7-.5s1.1.3 1.7.5c.6.2 1.5.3 2.2-.4.6-.6.7-1.4.5-2.1-.4-1.3-1.9-2.1-2.4-3.3-.2-.7 0-1.8.4-3 .4-1.2.9-2.4.9-3.8C14.8 4.1 15 2 12.5 2z"/></svg>';
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      }

      (function renderTypeTree() {
        const body = document.getElementById('traffic-types-body');
        if (!body) return;
        const groups = types && Array.isArray(types.rows) ? types.rows.slice() : [];
        if (!groups.length) {
          body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml('Open Settings (footer) → Traffic to choose device types.') + '</div></div>';
          return;
        }
        function typeLabel(r) {
          if (!r) return '—';
          if (r.label != null && String(r.label).trim() !== '') return String(r.label);
          if (r.platform != null && String(r.platform).trim() !== '') return String(r.platform);
          if (r.key != null && String(r.key).trim() !== '') return String(r.key);
          return '—';
        }
        groups.sort(function(a, b) {
          var primary = 0;
          if (typeBy === 'type') primary = cmpNullableText(typeLabel(a), typeLabel(b), typeDir);
          else if (typeBy === 'cr') primary = cmpNullableNumber(a && a.conversionPct, b && b.conversionPct, typeDir);
          else if (typeBy === 'orders') primary = cmpNullableNumber(a && a.orders, b && b.orders, typeDir);
          else if (typeBy === 'sessions') primary = cmpNullableNumber(a && a.sessions, b && b.sessions, typeDir);
          else if (typeBy === 'rev') primary = cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, typeDir);
          return primary ||
            cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
            cmpNullableNumber(a && a.orders, b && b.orders, 'desc') ||
            cmpNullableNumber(a && a.sessions, b && b.sessions, 'desc') ||
            cmpNullableText(typeLabel(a), typeLabel(b), 'asc');
        });

        var filteredGroups = groups.filter(function(g) {
          var s = (g && typeof g.sessions === 'number') ? g.sessions : 0;
          var o = (g && typeof g.orders === 'number') ? g.orders : 0;
          return s >= 1 || o >= 1;
        });
        if (!filteredGroups.length) {
          body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No traffic types with sessions or sales.</div></div>';
          return;
        }
        let html = '';
        filteredGroups.forEach(function(g) {
          const device = (g && g.device != null) ? String(g.device).trim().toLowerCase() : '';
          const open = trafficTypeExpanded === null ? true : !!(device && trafficTypeExpanded && trafficTypeExpanded[device]);
          const label = escapeHtml((g && g.label) ? String(g.label) : (g && g.key ? String(g.key) : '—'));
          const cr = (g && typeof g.conversionPct === 'number') ? pct(g.conversionPct) : '—';
          const orders = (g && typeof g.orders === 'number') ? formatSessions(g.orders) : '—';
          const sessions = (g && typeof g.sessions === 'number') ? formatSessions(g.sessions) : '—';
          const rev = (g && typeof g.revenueGbp === 'number') ? formatRevenueTableHtml(g.revenueGbp) : '—';
          html += '<div class="grid-row traffic-type-parent" role="row" data-device="' + escapeHtml(device) + '">' +
            '<div class="grid-cell" role="cell">' +
              '<button type="button" class="traffic-type-toggle" data-device="' + escapeHtml(device) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
                '<span class="tt-device-icon" aria-hidden="true">' + trafficTypeDeviceIcon(device) + '</span>' +
                '<span>' + label + '</span>' +
              '</button>' +
            '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(cr || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(orders || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(sessions || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + (rev || '—') + '</div>' +
          '</div>';

          const kids = (g && Array.isArray(g.children)) ? g.children.slice() : [];
          kids.sort(function(a, b) {
            var primary = 0;
            if (typeBy === 'type') primary = cmpNullableText(typeLabel(a), typeLabel(b), typeDir);
            else if (typeBy === 'cr') primary = cmpNullableNumber(a && a.conversionPct, b && b.conversionPct, typeDir);
            else if (typeBy === 'orders') primary = cmpNullableNumber(a && a.orders, b && b.orders, typeDir);
            else if (typeBy === 'sessions') primary = cmpNullableNumber(a && a.sessions, b && b.sessions, typeDir);
            else if (typeBy === 'rev') primary = cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, typeDir);
            return primary ||
              cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
              cmpNullableNumber(a && a.orders, b && b.orders, 'desc') ||
              cmpNullableNumber(a && a.sessions, b && b.sessions, 'desc') ||
              cmpNullableText(typeLabel(a), typeLabel(b), 'asc');
          });
          kids.forEach(function(c) {
            const clabel = escapeHtml((c && c.label) ? String(c.label) : (c && c.platform ? String(c.platform) : (c && c.key ? String(c.key) : '—')));
            const ccr = (c && typeof c.conversionPct === 'number') ? pct(c.conversionPct) : '—';
            const corders = (c && typeof c.orders === 'number') ? formatSessions(c.orders) : '—';
            const csessions = (c && typeof c.sessions === 'number') ? formatSessions(c.sessions) : '—';
            const crev = (c && typeof c.revenueGbp === 'number') ? formatRevenueTableHtml(c.revenueGbp) : '—';
            html += '<div class="grid-row traffic-type-child' + (open ? '' : ' is-hidden') + '" role="row" data-parent="' + escapeHtml(device) + '">' +
              '<div class="grid-cell" role="cell">' + clabel + '</div>' +
              '<div class="grid-cell" role="cell">' + escapeHtml(ccr || '—') + '</div>' +
              '<div class="grid-cell" role="cell">' + escapeHtml(corders || '—') + '</div>' +
              '<div class="grid-cell" role="cell">' + escapeHtml(csessions || '—') + '</div>' +
              '<div class="grid-cell" role="cell">' + (crev || '—') + '</div>' +
            '</div>';
          });
        });
        body.innerHTML = html;
      })();

      updateSortHeadersInContainer(document.getElementById('traffic-sources-table'), srcBy, srcDir);
      updateSortHeadersInContainer(document.getElementById('traffic-types-table'), typeBy, typeDir);
    }

    function renderTrafficPickers(data) {
      function renderPicker(containerId, available, enabled, onChange) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const have = new Set((enabled || []).map(function(k) { return String(k || '').trim().toLowerCase(); }).filter(Boolean));
        const list = Array.isArray(available) ? available.slice() : [];
        if (!list.length) {
          el.innerHTML = '<div class="dm-def-note">No items yet.</div>';
          return;
        }
        let html = '';
        list.forEach(function(item) {
          const key = item && item.key != null ? String(item.key).trim().toLowerCase() : '';
          if (!key) return;
          const label = escapeHtml(item.label != null ? String(item.label) : key);
          const checked = have.has(key);
          const meta = (item && typeof item.sessions === 'number') ? (formatSessions(item.sessions) + ' sessions') : '';
          html += '<label class="traffic-picker-item">' +
            '<input type="checkbox" data-key="' + key + '"' + (checked ? ' checked' : '') + ' />' +
            '<span>' + label + '</span>' +
            (meta ? ('<span class="traffic-picker-meta">' + escapeHtml(meta) + '</span>') : '') +
            '</label>';
        });
        el.innerHTML = html;
        el.onchange = function(e) {
          const t = e && e.target ? e.target : null;
          if (!t || t.tagName !== 'INPUT') return;
          const keys = Array.from(el.querySelectorAll('input[type="checkbox"][data-key]:checked'))
            .map(function(inp) { return (inp.getAttribute('data-key') || '').trim(); })
            .filter(Boolean);
          onChange(keys);
        };
      }

      renderPicker(
        'traffic-sources-picker',
        data && data.sources ? data.sources.available : [],
        data && data.sources ? data.sources.enabled : [],
        function(keys) { saveTrafficPrefs({ sourcesEnabled: keys }); }
      );
      renderPicker(
        'traffic-types-picker',
        data && data.types ? data.types.available : [],
        data && data.types ? data.types.enabled : [],
        function(keys) { saveTrafficPrefs({ typesEnabled: keys }); }
      );
    }

    var channelsChartInstance = null;
    var channelsChartData = null;
    var channelsChartType = 'bar';

    function renderChannelsChart(data, chartType) {
      var el = document.getElementById('channels-chart');
      if (!el) return;
      if (typeof ApexCharts === 'undefined') {
        setTimeout(function() { renderChannelsChart(data, chartType); }, 200);
        return;
      }
      if (channelsChartInstance) { try { channelsChartInstance.destroy(); } catch (_) {} channelsChartInstance = null; }
      if (data) channelsChartData = data;
      if (chartType) channelsChartType = chartType;
      var d = channelsChartData;
      var rows = d && d.sources && Array.isArray(d.sources.rows) ? d.sources.rows.slice() : [];
      rows = rows.filter(function(r) { return r && (r.revenueGbp > 0 || r.sessions > 0); });
      rows.sort(function(a, b) { return (b.revenueGbp || 0) - (a.revenueGbp || 0); });
      rows = rows.slice(0, 10);
      if (!rows.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);font-size:.875rem">No channel data available</div>';
        return;
      }
      var categories = rows.map(function(r) {
        var lbl = r.label || r.key || '—';
        return lbl.length > 25 ? lbl.substring(0, 22) + '...' : lbl;
      });
      var revenues = rows.map(function(r) { return r.revenueGbp || 0; });
      var ct = channelsChartType;
      var isBar = ct === 'bar';
      var fillConfig = ct === 'line' ? { type: 'solid', opacity: 0 }
        : ct === 'area' ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.15, opacityTo: 0.02, stops: [0, 100] } }
        : { type: 'solid', opacity: 1 };
      el.innerHTML = '';
      channelsChartInstance = new ApexCharts(el, {
        chart: { type: isBar ? 'bar' : ct, height: 320, fontFamily: 'Inter, sans-serif', toolbar: { show: false } },
        series: [{ name: 'Revenue', data: revenues }],
        colors: ['#4592e9'],
        plotOptions: isBar ? { bar: { horizontal: true, borderRadius: 3, barHeight: '65%' } } : {},
        stroke: { width: isBar ? 0 : 2, curve: 'smooth' },
        fill: fillConfig,
        markers: { size: ct === 'line' ? 3 : 0, hover: { size: 5 } },
        dataLabels: { enabled: false },
        xaxis: { categories: categories, labels: { style: { fontSize: '11px' }, formatter: isBar ? function(v) { return '\u00A3' + Number(v).toLocaleString(); } : undefined } },
        yaxis: { labels: { style: { fontSize: '11px' }, formatter: !isBar ? function(v) { return '\u00A3' + Number(v).toLocaleString(); } : undefined } },
        tooltip: { y: { formatter: function(v) { return '\u00A3' + Number(v).toFixed(2); } } },
        grid: { borderColor: '#f1f1f1', padding: { left: 0, right: 0 } }
      });
      channelsChartInstance.render();
      initChannelsChartSwitcher();
    }

    function initChannelsChartSwitcher() {
      var el = document.getElementById('channels-chart');
      if (!el) return;
      var card = el.closest('.card');
      if (!card) return;
      var header = card.querySelector('.card-header');
      if (!header || header.querySelector('.chart-type-switcher')) return;
      var wrap = document.createElement('div');
      wrap.className = 'chart-type-switcher ms-auto d-flex gap-1';
      [{ type: 'bar', icon: 'ti-chart-bar', label: 'Bar' }, { type: 'area', icon: 'ti-chart-area-line', label: 'Area' }, { type: 'line', icon: 'ti-chart-line', label: 'Line' }].forEach(function(t) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-icon btn-ghost-secondary btn-sm' + (t.type === channelsChartType ? ' active' : '');
        btn.setAttribute('aria-label', t.label);
        btn.innerHTML = '<i class="ti ' + t.icon + '"></i>';
        btn.addEventListener('click', function() {
          wrap.querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderChannelsChart(null, t.type);
        });
        wrap.appendChild(btn);
      });
      header.appendChild(wrap);
    }

    var typeChartInstance = null;

    function renderTypeChart(data) {
      var el = document.getElementById('type-chart');
      if (!el) return;
      if (typeof ApexCharts === 'undefined') {
        setTimeout(function() { renderTypeChart(data); }, 200);
        return;
      }
      if (typeChartInstance) { try { typeChartInstance.destroy(); } catch (_) {} typeChartInstance = null; }
      var rows = data && data.types && Array.isArray(data.types.rows) ? data.types.rows.slice() : [];
      rows = rows.filter(function(r) { return r && r.sessions > 0; });
      rows.sort(function(a, b) { return (b.sessions || 0) - (a.sessions || 0); });
      if (!rows.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);font-size:.875rem">No type data available</div>';
        return;
      }
      var labels = rows.map(function(r) { return r.label || r.key || '—'; });
      var sessions = rows.map(function(r) { return r.sessions || 0; });
      el.innerHTML = '';
      typeChartInstance = new ApexCharts(el, {
        chart: { type: 'donut', height: 320, fontFamily: 'Inter, sans-serif', toolbar: { show: false } },
        series: sessions,
        labels: labels,
        colors: ['#4592e9', '#1673b4', '#32bdb0', '#179ea8', '#fa9f2e', '#fab05d', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e'],
        plotOptions: { pie: { donut: { size: '65%', labels: { show: true, total: { show: true, label: 'Total Sessions', fontSize: '14px', formatter: function(w) { return w.globals.seriesTotals.reduce(function(a, b) { return a + b; }, 0).toLocaleString(); } } } } } },
        dataLabels: { enabled: true, formatter: function(val) { return val.toFixed(1) + '%'; } },
        legend: { position: 'bottom', fontSize: '12px' },
        tooltip: { y: { formatter: function(v) { return v.toLocaleString() + ' sessions'; } } }
      });
      typeChartInstance.render();
    }

    function renderTraffic(data) {
      trafficCache = data || trafficCache || null;
      renderTrafficTables(trafficCache);
      renderTrafficPickers(trafficCache);
      renderChannelsChart(trafficCache);
      renderTypeChart(trafficCache);
    }

    function fetchTrafficData(options = {}) {
      const force = !!options.force;
      let url = API + '/api/traffic?range=' + encodeURIComponent(getStatsRange());
      if (force) url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const cacheMode = force ? 'no-store' : 'default';
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: cacheMode }, 25000)
        .then(function(r) {
          if (!r.ok) throw new Error('Traffic HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          lastTrafficFetchedAt = Date.now();
          renderTraffic(data && typeof data === 'object' ? data : null);
          return data;
        })
        .catch(function(err) {
          console.error(err);
          renderTraffic(trafficCache || null);
          return null;
        });
    }

    function refreshTraffic(options = {}) {
      const force = !!options.force;
      if (trafficRefreshInFlight) return trafficRefreshInFlight;

      const build = startReportBuild({ key: 'traffic', overlayId: 'traffic-loading-overlay', stepId: 'traffic-build-step' });
      build.step('building channels...');
      trafficRefreshInFlight = fetchTrafficData({ force })
        .then(function(data) {
          build.step('building channels... done');
          return delay(180).then(function() {
            build.step('building traffic...');
            return delay(120).then(function() {
              build.step('building traffic... done');
              return delay(180).then(function() { return data; });
            });
          });
        })
        .finally(function() {
          trafficRefreshInFlight = null;
          build.finish();
        });
      return trafficRefreshInFlight;
    }

    function saveTrafficPrefs(payload) {
      if (!payload || typeof payload !== 'object') return Promise.resolve(null);
      return fetch(API + '/api/traffic-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload),
      })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(json) {
          if (!json || json.ok !== true) return null;
          // Re-fetch so tables match new enabled selections.
          refreshTraffic({ force: true });
          return json;
        })
        .catch(function(err) { console.error(err); return null; });
    }

    function sessionIdsEqual(a, b) {
      if (!a && !b) return true;
      if (!a || !b || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i].session_id !== b[i].session_id) return false;
      return true;
    }

    function fetchSessions() {
      if (liveRefreshInFlight) return liveRefreshInFlight;
      var overlay = document.getElementById('sessions-loading-overlay');
      if (overlay) overlay.classList.remove('is-hidden');
      showPageProgress();
      var isLive = dateRange === 'live';
      var url;
      if (isLive) {
        url = API + '/api/sessions?filter=active&_=' + Date.now();
      } else {
        var limit = rowsPerPage;
        var offset = (currentPage - 1) * rowsPerPage;
        url = API + '/api/sessions?range=' + encodeURIComponent(normalizeRangeKeyForApi(dateRange)) + '&limit=' + limit + '&offset=' + offset + '&timezone=' + encodeURIComponent(tz) + '&_=' + Date.now();
      }
      if (_fetchAbortControllers.sessions) { try { _fetchAbortControllers.sessions.abort(); } catch (_) {} }
      var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      _fetchAbortControllers.sessions = ac;
      liveRefreshInFlight = fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: ac ? ac.signal : undefined })
        .then(function(r) {
          if (!r.ok) {
            sessionsLoadError = r.status === 502 ? 'Server error (502). Try again or refresh.' : 'Server error (' + r.status + ').';
            sessions = [];
            sessionsTotal = null;
            renderTable();
            return null;
          }
          return r.json();
        })
        .then(function(data) {
          if (data == null) return null;
          sessionsLoadError = null;
          if (isLive) {
            sessionsTotal = null;
            var next = data.sessions || [];
            var cutoff = Date.now() - ACTIVE_WINDOW_MS;
            var arrivedCutoff = Date.now() - ARRIVED_WINDOW_MS;
            next = next.filter(function(s) {
              return (s.last_seen != null && s.last_seen >= cutoff) &&
                (s.started_at != null && s.started_at >= arrivedCutoff);
            });
            next.sort(function(a, b) { return (b.last_seen || 0) - (a.last_seen || 0); });
            var listChanged = !sessionIdsEqual(sessions, next);
            sessions = next;
            if (listChanged) currentPage = 1;
          } else {
            sessions = data.sessions || [];
            sessionsTotal = typeof data.total === 'number' ? data.total : sessions.length;
          }
          lastSessionsMode = isLive ? 'live' : 'range';
          lastSessionsFetchedAt = Date.now();
          if (isLive) nextLiveAt = Date.now() + LIVE_REFRESH_MS;
          else if (dateRange === 'today' || dateRange === 'sales' || dateRange === '1h') nextRangeAt = Date.now() + RANGE_REFRESH_MS;
          lastUpdateTime = new Date();
          updateServerTimeDisplay();
          renderTable();
          updateKpis();
          return sessions;
        })
        .catch(function(err) { if (err && err.name === 'AbortError') return null; sessionsLoadError = 'Could not load sessions. Check connection or refresh.'; sessions = []; sessionsTotal = null; currentPage = 1; renderTable(); return null; })
        .finally(function() {
          liveRefreshInFlight = null;
          if (_fetchAbortControllers.sessions === ac) _fetchAbortControllers.sessions = null;
          if (overlay) overlay.classList.add('is-hidden');
          hidePageProgress();
        });
      return liveRefreshInFlight;
    }

    function fetchOnlineCount() {
      if (onlineCountInFlight) return;
      onlineCountInFlight = true;
      if (_fetchAbortControllers.onlineCount) { try { _fetchAbortControllers.onlineCount.abort(); } catch (_) {} }
      var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      _fetchAbortControllers.onlineCount = ac;
      fetch(API + '/api/sessions?filter=active&countOnly=1&_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store', signal: ac ? ac.signal : undefined })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (data != null && typeof data.count === 'number') {
            lastOnlineCount = data.count;
          }
        })
        .catch(function() {})
        .then(function() {
          onlineCountInFlight = false;
          if (_fetchAbortControllers.onlineCount === ac) _fetchAbortControllers.onlineCount = null;
          updateKpis();
        });
    }

    function updateKpis() {
      const el = document.getElementById('online-count');
      const spinner = document.getElementById('online-count-spinner');
      if (!el) return;
      function showSpinner() {
        if (spinner) spinner.classList.remove('is-hidden');
        el.classList.add('is-hidden');
      }
      function showCount(n) {
        if (spinner) spinner.classList.add('is-hidden');
        el.classList.remove('is-hidden');
        el.textContent = String(n);
      }
      if (dateRange === 'live') {
        if (lastSessionsMode !== 'live') {
          showSpinner();
          fetchSessions();
          return;
        }
        const active = sessions.filter(s => s.last_seen >= Date.now() - ACTIVE_WINDOW_MS).length;
        showCount(active);
        return;
      }
      // Online is real people online right now; show count regardless of date range (Today, Yesterday, etc.)
      if (lastOnlineCount != null) {
        showCount(lastOnlineCount);
      } else {
        showSpinner();
        fetchOnlineCount();
      }
    }

    function cfSection(title, value) {
      const v = value != null && String(value).trim() !== '' ? String(value).trim() : null;
      const cls = v ? 'cf-row' : 'cf-row empty';
      return '<div class="' + cls + '"><strong>' + escapeHtml(title) + ':</strong> ' + (v ? escapeHtml(v) : '\u2014') + '</div>';
    }

    function buildSidePanelCf(session) {
      const s = session || {};
      const blocks = [
        ['Country & Device', cfSection('Country', s.cf_country || s.country_code) + cfSection('Device', s.device)],
        ['Referrer / Entry', cfSection('Referrer', s.referrer) + cfSection('Entry URL', s.entry_url)],
        ['Colo / ASN', cfSection('Colo', s.cf_colo) + cfSection('ASN', s.cf_asn)],
        ['Bot', cfSection('Known bot', s.cf_known_bot != null ? (s.cf_known_bot === 1 ? 'Yes' : 'No') : null) + cfSection('Verified bot category', s.cf_verified_bot_category)],
        ['City', cfSection('City', null)]
      ];
      return blocks.map(function (b) { return '<div class="side-panel-cf-block"><div class="side-panel-cf-subtitle">' + escapeHtml(b[0]) + '</div>' + b[1] + '</div>'; }).join('');
    }

    function openSidePanel(sessionId) {
      const panel = document.getElementById('side-panel');
      panel.classList.remove('is-hidden');
      document.getElementById('side-events').innerHTML = '<li class="muted">Loading\u2026</li>';
      document.getElementById('side-meta').innerHTML = '<div class="side-panel-detail-row"><span class="side-panel-value muted">Loading\u2026</span></div>';
      const sideSourceEl = document.getElementById('side-source');
      if (sideSourceEl) sideSourceEl.textContent = '';
      document.getElementById('side-cf').innerHTML = '';
      fetch(API + '/api/sessions/' + encodeURIComponent(sessionId) + '/events?limit=20')
        .then(r => r.json())
        .then(data => {
          const session = sessions.find(s => s.session_id === sessionId) || {};
          const saleBlock = session.has_purchased
            ? '<div class="side-panel-sale"><strong>Sale</strong><br>Order: ' + escapeHtml(formatMoney(session.order_total, session.order_currency) || '\u2014') + (session.purchased_at ? '<br>Purchased: ' + formatTs(session.purchased_at) : '') + '</div>'
            : '';
          const mainBase = getMainBaseUrl();
          const eventList = (data.events || []).filter(e => e.type !== 'heartbeat').reverse();
          const eventsHtml = eventList.map(e => {
            var path = (e.path || '').trim();
            if (!path && e.product_handle) path = '/products/' + (e.product_handle || '');
            if (path && !path.startsWith('/')) path = '/' + path;
            var pathLabel = path ? (friendlyLabelFromPath(path) || path) : (e.product_handle || '');
            var fullUrl = mainBase && path ? mainBase + path : '';
            var thumb = fullUrl ? '<img class="landing-thumb" src="' + (API || '') + '/api/og-thumb?url=' + encodeURIComponent(fullUrl) + '&width=100' + '" alt="" onerror="this.classList.add(\'is-hidden\')">' : '';
            var text = formatTs(e.ts) + ' ' + escapeHtml(e.type) + ' ' + escapeHtml(pathLabel) + (e.qty_delta != null ? ' \u0394' + e.qty_delta : '');
            return '<li>' + thumb + '<span>' + text + '</span></li>';
          }).join('');
          document.getElementById('side-events').innerHTML = eventsHtml || '<li class="muted">No events</li>';
          const metaRows = [
            ['Session', sessionId],
            ['Visitor', session.visitor_id || '\u2014'],
            ['Started', formatTs(session.started_at)],
            ['Seen', formatTs(session.last_seen)],
            ['Cart qty', String(session.cart_qty ?? 0)]
          ].map(function (r) { return '<div class="side-panel-detail-row"><span class="side-panel-label">' + escapeHtml(r[0]) + '</span><span class="side-panel-value">' + escapeHtml(String(r[1])) + '</span></div>'; }).join('');
          var startedMs = session.started_at != null ? Number(session.started_at) : 0;
          var seenMs = session.last_seen != null ? Number(session.last_seen) : 0;
          var gapHours = (seenMs - startedMs) / (60 * 60 * 1000);
          var openTabHint = (gapHours >= 1) ? '<div class="side-panel-detail-row muted side-panel-hint">If Started and Seen are many hours apart, the visitor likely left the tab open; we receive a heartbeat every 30s which updates Seen.</div>' : '';
          document.getElementById('side-meta').innerHTML = metaRows + openTabHint + (saleBlock ? saleBlock : '');
          if (sideSourceEl) sideSourceEl.textContent = sourceDetailForPanel(session);
          document.getElementById('side-cf').innerHTML = buildSidePanelCf(session);
        })
        .catch(() => {
          document.getElementById('side-events').innerHTML = '<li class="muted">Failed to load.</li>';
          document.getElementById('side-meta').innerHTML = '<div class="side-panel-detail-row"><span class="side-panel-value muted">Failed to load.</span></div>';
        });
    }

    const sideCloseBtn = document.getElementById('side-close');
    if (sideCloseBtn) {
      sideCloseBtn.addEventListener('click', () => {
        const panel = document.getElementById('side-panel');
        if (panel) panel.classList.add('is-hidden');
      });
    }

    // Session table pagination (live/sales/date) — delegated
    (function initSessionTablePagination() {
      var wrap = document.getElementById('table-pagination');
      if (!wrap) return;
      wrap.addEventListener('click', function(e) {
        var link = e.target.closest('a[data-page]');
        if (!link) return;
        e.preventDefault();
        if (link.closest('.page-item.disabled') || link.closest('.page-item.active')) return;
        var pg = parseInt(link.dataset.page, 10);
        if (!pg || pg < 1) return;
        currentPage = pg;
        if (sessionsTotal != null) fetchSessions(); else renderTable();
      });
    })();

    setupSortableHeaders();
    setupBestSellersSort();
    setupAllTableSorts();

    // Card-table pagination — event delegation on containers
    (function initTopTablePagination() {
      function bindDelegate(prefix, goToPage) {
        var wrap = document.getElementById(prefix + '-pagination');
        if (!wrap) return;
        wrap.addEventListener('click', function(e) {
          var link = e.target.closest('a[data-page]');
          if (!link) return;
          e.preventDefault();
          if (link.closest('.page-item.disabled') || link.closest('.page-item.active')) return;
          var pg = parseInt(link.dataset.page, 10);
          if (!pg || pg < 1) return;
          goToPage(pg);
        });
      }
      bindDelegate('country', function(pg) { countryPage = pg; renderCountry(statsCache); });
      bindDelegate('best-geo-products', function(pg) { bestGeoProductsPage = pg; renderBestGeoProducts(statsCache); });
      bindDelegate('best-sellers', function(pg) { bestSellersPage = pg; fetchBestSellers(); });
      bindDelegate('best-variants', function(pg) { bestVariantsPage = pg; fetchBestVariants(); });
      bindDelegate('breakdown-aov', function(pg) { breakdownAovPage = pg; renderAov(statsCache); });
      bindDelegate('breakdown-title', function(pg) { breakdownTitlePage = pg; renderBreakdownTitles(leaderboardCache); });
      bindDelegate('breakdown-finish', function(pg) { breakdownFinishPage = pg; renderBreakdownFinishes(finishesCache); });
      bindDelegate('breakdown-length', function(pg) { breakdownLengthPage = pg; renderBreakdownLengths(lengthsCache); });
      bindDelegate('breakdown-chainstyle', function(pg) { breakdownChainStylePage = pg; renderBreakdownChainStyles(chainStylesCache); });
    })();

    (function initRowsPerPageSelect() {
      // Rows-per-page UI is intentionally hidden; keep page size fixed at default.
      const sel = document.getElementById('rows-per-page-select');
      if (sel) sel.value = String(rowsPerPage);
    })();

    function getConfigStatusUrl(options = {}) {
      var url = API + '/api/config-status';
      try {
        var shop = getShopParam();
        if (!shop && typeof shopForSalesFallback === 'string' && shopForSalesFallback) shop = shopForSalesFallback;
        if (shop) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'shop=' + encodeURIComponent(shop);
      } catch (_) {}
      if (options && options.force) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      }
      return url;
    }

    function getReconcileSalesUrl(options = {}) {
      var url = API + '/api/reconcile-sales?range=7d';
      try {
        var shop = getShopParam();
        if (!shop && typeof shopForSalesFallback === 'string' && shopForSalesFallback) shop = shopForSalesFallback;
        if (shop) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'shop=' + encodeURIComponent(shop);
      } catch (_) {}
      if (options && options.force) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      }
      return url;
    }

    function reconcileSalesTruth(options = {}) {
      const btn = document.getElementById('config-reconcile-btn');
      if (btn) {
        btn.classList.add('spinning');
        btn.disabled = true;
      }
      const p = fetch(getReconcileSalesUrl({ force: true }), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      })
        .then(r => r.json())
        .then(() => {
          try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
          try { fetchTrafficData({ force: true }); } catch (_) {}
        })
        .catch(() => {
          // Best-effort: diagnostics panel already handles refresh errors.
        })
        .finally(() => {
          if (btn) {
            btn.classList.remove('spinning');
            btn.disabled = false;
          }
        });
      return p;
    }

    var activeDiagTabKey = 'sales';

    function isConfigModalOpen() {
      try {
        const m = document.getElementById('config-modal');
        return !!(m && m.classList && m.classList.contains('open'));
      } catch (_) {
        return false;
      }
    }

    function refreshConfigStatus(options = {}) {
      if (configStatusRefreshInFlight && !options.force) return configStatusRefreshInFlight;
      const refreshBtn = document.getElementById('config-refresh-btn');
      const configStatusEl = document.getElementById('config-status');
      const compareModalEl = document.getElementById('kpi-compare-modal');
      const compareRefreshBtn = document.getElementById('kpi-compare-refresh-btn');
      const compareStatusEl = document.getElementById('kpi-compare-status');
      const compareUpdatedEl = document.getElementById('kpi-compare-updated');
      const compareKickerEl = document.getElementById('kpi-compare-kicker');
      const compareOpen = !!(compareModalEl && compareModalEl.classList.contains('open'));
      const preserveView = !!(options && options.preserveView);
      const modalCardEl = preserveView ? document.querySelector('#config-modal .config-modal-card') : null;
      const prevModalScrollTop = (preserveView && modalCardEl) ? (modalCardEl.scrollTop || 0) : 0;
      if (configStatusEl && !preserveView) {
        configStatusEl.innerHTML = '<div class="dm-loading-spinner"><div class="report-build-wrap"><div class="spinner-border text-primary" role="status"></div><div class="report-build-title">building diagnostics</div><div class="report-build-step">—</div></div></div>';
      }
      if (compareOpen && compareStatusEl) compareStatusEl.innerHTML = '<div class="kpi-compare-loading"><div class="report-build-wrap"><div class="spinner-border text-primary" role="status"></div><div class="report-build-title">building KPI comparison</div><div class="report-build-step">—</div></div></div>';

      if (refreshBtn) refreshBtn.classList.add('spinning');
      if (compareOpen && compareRefreshBtn) compareRefreshBtn.classList.add('spinning');
      const p = fetch(getConfigStatusUrl({ force: !!options.force }), { credentials: 'same-origin', cache: 'no-store' })
        .then(r => r.json())
        .then(c => {
          function code(value) { return '<code>' + escapeHtml(value == null ? '' : String(value)) + '</code>'; }
          function pill(text, tone) {
            const t = (tone === 'bad' || tone === 'warn') ? tone : 'ok';
            return '<span class="diag-pill ' + t + '">' + escapeHtml(String(text || '')) + '</span>';
          }
          function kv(label, valueHtml) {
            return '<div class="diag-kv"><div class="k">' + escapeHtml(label) + '</div><div class="v">' + valueHtml + '</div></div>';
          }
          function icon(name, cls) {
            const k = cls ? (' class="' + cls + '"') : '';
            if (name === 'shield') {
              return '<svg' + k + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
            }
            if (name === 'columns') {
              return '<svg' + k + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"/><path d="M3 4h18v16H3z"/></svg>';
            }
            if (name === 'list') {
              return '<svg' + k + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
            }
            if (name === 'bag') {
              return '<svg' + k + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';
            }
            if (name === 'activity') {
              return '<svg' + k + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
            }
            if (name === 'bar') {
              return '<svg' + k + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>';
            }
            if (name === 'server') {
              return '<svg' + k + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>';
            }
            if (name === 'key') {
              return '<svg' + k + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.5 7.5a4.5 4.5 0 1 1 0-6.36A4.5 4.5 0 0 1 11.5 11.5z"/><path d="M15 7l4 4"/><path d="M13 9l2 2"/></svg>';
            }
            if (name === 'link') {
              return '<svg' + k + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
            }
            if (name === 'chev') {
              return '<svg' + k + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
            }
            return '';
          }
          function fmtSessions(n) { return (typeof n === 'number' && isFinite(n)) ? escapeHtml(formatSessions(n)) : '\u2014'; }
          function fmtRevenue(n) { return (typeof n === 'number' && isFinite(n)) ? escapeHtml(formatRevenue(n)) : '\u2014'; }
          function fmtTsMaybe(ms) { return (typeof ms === 'number' && isFinite(ms)) ? escapeHtml(formatTs(ms)) : '\u2014'; }
          function fmtPct(p) {
            if (typeof p !== 'number' || !isFinite(p)) return '\u2014';
            const s = (Math.round(p * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
            return escapeHtml(s + '%');
          }
          function fmtSigned(n, fmtAbsFn, unitSuffix) {
            if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
            const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
            const abs = Math.abs(n);
            const core = fmtAbsFn ? fmtAbsFn(abs) : String(abs);
            return escapeHtml(sign + core + (unitSuffix || ''));
          }

          const app = c && c.app ? c.app : {};
          const shopify = c && c.shopify ? c.shopify : {};
          const db = c && c.db ? c.db : {};
          const ingest = c && c.ingest ? c.ingest : {};
          const reporting = c && c.reporting ? c.reporting : {};
          const traffic = c && c.traffic ? c.traffic : {};
          const sales = c && c.sales ? c.sales : {};
          const truth = sales && sales.truth ? sales.truth : {};
          const truthToday = truth && truth.today ? truth.today : {};
          const health = truth && truth.health ? truth.health : {};
          const evidenceToday = sales && sales.evidence && sales.evidence.today ? sales.evidence.today : {};
          const driftOrders = sales && sales.drift && typeof sales.drift.orders === 'number' ? sales.drift.orders : null;
          const pixelDerivedToday = sales && sales.pixel && sales.pixel.today ? sales.pixel.today : {};
          const pixelDerivedOrders = (typeof pixelDerivedToday.orderCount === 'number') ? pixelDerivedToday.orderCount : null;
          const pixelDerivedRevenue = (typeof pixelDerivedToday.revenueGbp === 'number') ? pixelDerivedToday.revenueGbp : null;
          const driftPixelOrders = sales && sales.drift && typeof sales.drift.pixelVsTruthOrders === 'number' ? sales.drift.pixelVsTruthOrders : null;
          const driftPixelRevenue = sales && sales.drift && typeof sales.drift.pixelVsTruthRevenueGbp === 'number' ? sales.drift.pixelVsTruthRevenueGbp : null;
          const missingEvidenceToday = sales && sales.missingEvidence && sales.missingEvidence.today ? sales.missingEvidence.today : {};
          const missingEvidenceCount = (missingEvidenceToday && typeof missingEvidenceToday.missingOrderCount === 'number')
            ? missingEvidenceToday.missingOrderCount
            : null;
          const missingEvidenceSample = (missingEvidenceToday && Array.isArray(missingEvidenceToday.missingOrdersSample))
            ? missingEvidenceToday.missingOrdersSample
            : [];
          const missingEvidenceNote = (missingEvidenceToday && typeof missingEvidenceToday.note === 'string')
            ? missingEvidenceToday.note
            : '';
          const pixel = c && c.pixel ? c.pixel : {};
          const appSettings = c && c.settings ? c.settings : {};
          const trackerDefinitions = c && c.trackerDefinitions ? c.trackerDefinitions : null;
          const pixelSessionMode = (appSettings && appSettings.pixelSessionMode != null)
            ? String(appSettings.pixelSessionMode).trim().toLowerCase()
            : 'legacy';
          const sharedSessionFixEnabled = pixelSessionMode === 'shared_ttl';

          const truthOrders = (typeof truthToday.orderCount === 'number') ? truthToday.orderCount : null;
          const truthRevenue = (typeof truthToday.revenueGbp === 'number') ? truthToday.revenueGbp : null;
          const truthCheckoutOrders = (typeof truthToday.checkoutOrderCount === 'number') ? truthToday.checkoutOrderCount : null;
          const truthCheckoutRevenue = (typeof truthToday.checkoutRevenueGbp === 'number') ? truthToday.checkoutRevenueGbp : null;
          const truthReturningCustomers = (typeof truthToday.returningCustomerCount === 'number') ? truthToday.returningCustomerCount : null;
          const truthReturningRevenue = (typeof truthToday.returningRevenueGbp === 'number') ? truthToday.returningRevenueGbp : null;
          const evTotal = (typeof evidenceToday.checkoutCompleted === 'number') ? evidenceToday.checkoutCompleted : null;
          const evSessions = (typeof evidenceToday.checkoutCompletedSessions === 'number') ? evidenceToday.checkoutCompletedSessions : null;
          const evLinked = (typeof evidenceToday.linked === 'number') ? evidenceToday.linked : null;
          const evUnlinked = (typeof evidenceToday.unlinked === 'number') ? evidenceToday.unlinked : null;
          const staleSec = (health && typeof health.staleMs === 'number') ? Math.round(health.staleMs / 1000) : null;

          const SHOPIFY_LOGO_URL = 'https://cdn.shopify.com/s/files/1/0847/7261/8587/files/shopify.png?v=1770259752';
          const KEXO_LOGO_URL = '/assets/kexo_logo_fullcolor.webp';

          const shopifySessionsToday = (traffic && typeof traffic.shopifySessionsToday === 'number') ? traffic.shopifySessionsToday : null;
          const shopifyConversionRateToday = (traffic && typeof traffic.shopifyConversionRateToday === 'number') ? traffic.shopifyConversionRateToday : null;
          const shopifyConversionRateNote = (traffic && typeof traffic.shopifyConversionRateTodayNote === 'string') ? traffic.shopifyConversionRateTodayNote : '';
          const kexoSessionsToday = (traffic && traffic.today && typeof traffic.today.humanSessions === 'number') ? traffic.today.humanSessions :
            (traffic && traffic.today && typeof traffic.today.sessionsReachedApp === 'number') ? traffic.today.sessionsReachedApp : null;
          const botsBlockedToday = (traffic && traffic.today && typeof traffic.today.botsBlockedAtEdge === 'number') ? traffic.today.botsBlockedAtEdge : null;
          const botsBlockedUpdatedAt = (traffic && traffic.today && typeof traffic.today.botsBlockedAtEdgeUpdatedAt === 'number') ? traffic.today.botsBlockedAtEdgeUpdatedAt : null;

          // Conversion rate used across Kexo tables: truth orders / sessions.
          // Prefer checkout-token truth orders (online-store proxy) when available.
          const convertedOrdersForCr = (truthCheckoutOrders != null ? truthCheckoutOrders : truthOrders);
          const shopifyCr = (shopifyConversionRateToday != null)
            ? shopifyConversionRateToday
            : ((convertedOrdersForCr != null && shopifySessionsToday != null && shopifySessionsToday > 0)
              ? (convertedOrdersForCr / shopifySessionsToday) * 100
              : null);
          const kexoCr = (convertedOrdersForCr != null && kexoSessionsToday != null && kexoSessionsToday > 0) ? (convertedOrdersForCr / kexoSessionsToday) * 100 : null;
          const shopifyCrSource = (shopifyConversionRateToday != null)
            ? 'traffic.shopifyConversionRateToday (ShopifyQL conversion_rate)'
            : 'computed: truth orders / Shopify sessions (fallback)';

          const driftPixelCheckoutOrders = (truthCheckoutOrders != null && pixelDerivedOrders != null) ? (pixelDerivedOrders - truthCheckoutOrders) : null;
          const driftPixelCheckoutRevenue = (truthCheckoutRevenue != null && pixelDerivedRevenue != null)
            ? (Math.round((pixelDerivedRevenue - truthCheckoutRevenue) * 100) / 100)
            : null;
          const driftEvidenceCheckoutOrders = (truthCheckoutOrders != null && evTotal != null) ? (evTotal - truthCheckoutOrders) : null;

          const sessionsDiff = (shopifySessionsToday != null && kexoSessionsToday != null) ? (shopifySessionsToday - kexoSessionsToday) : null;
          const crDiff = (shopifyCr != null && kexoCr != null) ? (shopifyCr - kexoCr) : null;

          const storedScopesStr = (shopify && shopify.storedScopes) ? String(shopify.storedScopes) : '';
          const serverScopesStr = (shopify && shopify.serverScopes) ? String(shopify.serverScopes) : '';
          const storedScopes = storedScopesStr ? storedScopesStr.split(',').map(s => s.trim()).filter(Boolean) : [];
          const serverScopes = serverScopesStr ? serverScopesStr.split(',').map(s => s.trim()).filter(Boolean) : [];
          const missingScopes = (storedScopes.length && serverScopes.length) ? serverScopes.filter(s => storedScopes.indexOf(s) === -1) : [];

          const pixelIngestUrl = (pixel && pixel.ingestUrl != null) ? String(pixel.ingestUrl) : '';
          const expectedIngestUrl = (ingest && ingest.effectiveIngestUrl != null) ? String(ingest.effectiveIngestUrl) : '';
          const ingestUrlMatch = (pixelIngestUrl && expectedIngestUrl) ? (pixelIngestUrl === expectedIngestUrl) : null;

          function diffCell(text, cls) {
            const c = cls ? (' ' + cls) : '';
            return '<span class="' + c.trim() + '">' + escapeHtml(text) + '</span>';
          }

          function renderTrackerDefinitions(defs) {
            if (!defs || !Array.isArray(defs.tables)) {
              return '<div class="dm-def-note">No tracker definitions available from server.</div>';
            }

            function pill2(text, tone) {
              const t = (tone === 'bad' || tone === 'warn') ? tone : 'ok';
              return '<span class="dm-pill dm-pill-' + t + '">' + escapeHtml(String(text || '')) + '</span>';
            }
            function code2(value) {
              return '<code class="dm-code">' + escapeHtml(value == null ? '' : String(value)) + '</code>';
            }
            function line2(label, valueHtml) {
              return (
                '<div class="dm-row-kv">' +
                  '<div class="dm-k">' + escapeHtml(label) + '</div>' +
                  '<div class="dm-v">' + (valueHtml || '\u2014') + '</div>' +
                '</div>'
              );
            }
            function sectionTitle2(text) {
              return '<div class="dm-def-section-title">' + escapeHtml(text) + '</div>';
            }

            const ver = (defs.version != null) ? String(defs.version) : '';
            const last = (defs.lastUpdated != null) ? String(defs.lastUpdated) : '';
            const note = defs.note ? String(defs.note) : '';
            const defsTables = Array.isArray(defs.tables) ? defs.tables : [];

            const byPage = {};
            for (const d of defsTables) {
              const p = (d && d.page) ? String(d.page) : 'Other';
              if (!byPage[p]) byPage[p] = [];
              byPage[p].push(d);
            }

            const preferredOrder = ['Home', 'Overview', 'Countries', 'Products', 'Traffic', 'Diagnostics', 'Other'];
            const pages = Object.keys(byPage || {});
            pages.sort(function(a, b) {
              const ia = preferredOrder.indexOf(a);
              const ib = preferredOrder.indexOf(b);
              if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
              if (ia === -1) return 1;
              if (ib === -1) return -1;
              return ia - ib;
            });

            let out = '';
            out += '<div class="dm-def-root">';
            const metaBits = [];
            if (ver) metaBits.push('v' + ver);
            if (last) metaBits.push('Last updated ' + last);
            if (metaBits.length) out += '<div class="dm-def-meta">' + escapeHtml(metaBits.join(' · ')) + '</div>';
            if (note) out += '<div class="dm-def-note">' + escapeHtml(note) + '</div>';

            if (!pages.length) {
              out += '<div class="dm-def-note">No definitions found.</div>';
              out += '</div>';
              return out;
            }

            for (const page of pages) {
              const list = Array.isArray(byPage[page]) ? byPage[page].slice() : [];
              list.sort(function(a, b) { return String((a && a.name) || '').localeCompare(String((b && b.name) || '')); });

              out += '<div class="dm-def-page-box">';
              out +=   '<div class="dm-def-page-title">' + escapeHtml(page) + '</div>';

              for (const d of list) {
                const id = (d && d.id) ? String(d.id) : '';
                const name = (d && d.name) ? String(d.name) : (id || 'Unnamed');
                const endpoint = (d && d.endpoint) ? d.endpoint : {};
                const method = endpoint && endpoint.method ? String(endpoint.method) : '';
                const path = endpoint && endpoint.path ? String(endpoint.path) : '';
                const params = (endpoint && Array.isArray(endpoint.params)) ? endpoint.params : [];
                const uiIds = (d && d.ui && Array.isArray(d.ui.elementIds)) ? d.ui.elementIds : [];
                const uiMissing = uiIds.filter(function(x) { return x && !document.getElementById(String(x)); });

                const checks = (d && d.checks) ? d.checks : {};
                const activeMissingTables = (checks && Array.isArray(checks.activeDbTablesMissing)) ? checks.activeDbTablesMissing : null;
                const missingTables = activeMissingTables != null
                  ? activeMissingTables
                  : ((checks && Array.isArray(checks.dbTablesMissing)) ? checks.dbTablesMissing : []);
                const dbOk = (missingTables.length === 0);
                const tokenOk = (checks && checks.shopifyTokenOk === true) || !(d && d.requires && d.requires.shopifyToken);
                const uiOk = (uiMissing.length === 0);
                const overallOk = dbOk && tokenOk && uiOk;

                const summaryBits = [];
                if (method && path) summaryBits.push(method + ' ' + path);
                if (params.length) summaryBits.push('params: ' + params.join(', '));
                if (!summaryBits.length && id) summaryBits.push(id);

                const chips = [];
                chips.push(overallOk ? pill2('OK', 'ok') : pill2('Check', (missingTables.length ? 'bad' : 'warn')));
                if (uiIds.length) chips.push(uiOk ? pill2('UI OK', 'ok') : pill2('UI missing', 'warn'));
                if (missingTables.length) chips.push(pill2('DB missing', 'bad'));
                if (d && d.requires && d.requires.shopifyToken) chips.push(tokenOk ? pill2('Token OK', 'ok') : pill2('Token missing', 'bad'));

                out += '<details class="dm-def-details">';
                out +=   '<summary>';
                out +=     '<div style="min-width:0;">';
                out +=       '<div class="dm-def-details-name">' + escapeHtml(name) + '</div>';
                out +=       '<div class="dm-def-details-sub">' + escapeHtml(summaryBits.join(' · ')) + '</div>';
                out +=     '</div>';
                out +=     '<div class="dm-def-details-chips">' + chips.join('') + '</div>';
                out +=   '</summary>';

                out +=   '<div class="dm-def-details-body">';
                if (id) out += line2('Id', code2(id));
                if (method && path) out += line2('Endpoint', code2(method + ' ' + path));
                if (params.length) out += line2('Params', code2(params.join(', ')));
                if (uiIds.length) out += line2('UI elementIds', code2(uiIds.join(', ')));
                if (uiMissing.length) out += line2('UI missing', code2(uiMissing.join(', ')));
                if (missingTables.length) out += line2('DB tables missing', code2(missingTables.join(', ')));
                if (d && d.requires && d.requires.shopifyToken) out += line2('Shopify token', tokenOk ? pill2('OK', 'ok') : pill2('Missing', 'bad'));

                const respects = (d && d.respectsReporting) ? d.respectsReporting : {};
                const rOrders = !!(respects && respects.ordersSource);
                const rSessions = !!(respects && respects.sessionsSource);
                const respectsBits = [];
                respectsBits.push('ordersSource ' + (rOrders ? 'YES' : 'NO'));
                respectsBits.push('sessionsSource ' + (rSessions ? 'YES' : 'NO'));
                const nowBits = [];
                if (rOrders && reporting && reporting.ordersSource) nowBits.push('ordersSource=' + reporting.ordersSource);
                if (rSessions && reporting && reporting.sessionsSource) nowBits.push('sessionsSource=' + reporting.sessionsSource);
                out += line2('Respects reporting', code2(respectsBits.join(' · ') + (nowBits.length ? (' · now ' + nowBits.join(', ')) : '')));

                const sources = (d && Array.isArray(d.sources)) ? d.sources : [];
                if (sources.length) {
                  out += sectionTitle2('Sources');
                  out += '<ul class="dm-def-list">';
                  for (const s of sources) {
                    const kind = (s && s.kind) ? String(s.kind) : 'source';
                    const st = (s && Array.isArray(s.tables)) ? s.tables : [];
                    const note2 = (s && s.note) ? String(s.note) : '';
                    let line = '<strong>' + escapeHtml(kind) + '</strong>';
                    if (st.length) line += ' · ' + escapeHtml(st.join(', '));
                    if (note2) line += ' — ' + escapeHtml(note2);
                    out += '<li>' + line + '</li>';
                  }
                  out += '</ul>';
                }

                const columns = (d && Array.isArray(d.columns)) ? d.columns : [];
                if (columns.length) {
                  out += sectionTitle2('Columns + math');
                  out += '<ul class="dm-def-list">';
                  for (const col of columns) {
                    const cn = (col && col.name) ? String(col.name) : 'Column';
                    const cv = (col && col.value != null) ? String(col.value) : '';
                    const cf = (col && col.formula != null) ? String(col.formula) : '';
                    let line = '<strong>' + escapeHtml(cn) + '</strong>';
                    if (cv) line += ' · ' + escapeHtml(cv);
                    if (cf) line += ' · <code class="dm-code">' + escapeHtml(cf) + '</code>';
                    out += '<li>' + line + '</li>';
                  }
                  out += '</ul>';
                }

                const math = (d && Array.isArray(d.math)) ? d.math : [];
                if (math.length) {
                  out += sectionTitle2('Notes');
                  out += '<ul class="dm-def-list">';
                  for (const m of math) {
                    const mn = (m && m.name) ? String(m.name) : 'Note';
                    const mv = (m && m.value != null) ? String(m.value) : '';
                    out += '<li><strong>' + escapeHtml(mn) + '</strong>' + (mv ? (' · ' + escapeHtml(mv)) : '') + '</li>';
                  }
                  out += '</ul>';
                }

                out +=   '</div>';
                out += '</details>';
              }

              out += '</div>';
            }

            out += '</div>';
            return out;
          }

          // --- New flattened, top-tab Diagnostics UI (inline-styled) ---
          const shopifyOrderRate = shopifyCr;
          const kexoOrderRate = kexoCr;
          const orderRateDiff = (shopifyOrderRate != null && kexoOrderRate != null) ? (shopifyOrderRate - kexoOrderRate) : null;

          const evidenceExpected = (truthCheckoutOrders != null ? truthCheckoutOrders : truthOrders);

          function pillInline(text, tone) {
            const t = (tone === 'bad' || tone === 'warn') ? tone : 'ok';
            return '<span class="dm-pill dm-pill-' + t + '">' + escapeHtml(String(text || '')) + '</span>';
          }
          function codeInline(value) {
            return '<code class="dm-code">' + escapeHtml(value == null ? '' : String(value)) + '</code>';
          }
          function card(title, bodyHtml) {
            const h = title ? ('<div class="dm-card-title">' + escapeHtml(title) + '</div>') : '';
            return '<div class="dm-card">' + h + (bodyHtml || '') + '</div>';
          }
          function brandHeader(name, iconUrl, subtitle, accentRgb) {
            const sub = subtitle ? ('<div class="dm-brand-sub">' + escapeHtml(subtitle) + '</div>') : '';
            return (
              '<div class="dm-brand-header">' +
                '<div class="dm-brand-header-inner">' +
                  '<img src="' + escapeHtml(String(iconUrl || '')) + '" alt="' + escapeHtml(String(name || '')) + '" class="dm-brand-icon" />' +
                  '<div style="min-width:0;line-height:1.1;">' +
                    '<div class="dm-brand-name">' + escapeHtml(String(name || '')) + '</div>' +
                    sub +
                  '</div>' +
                '</div>' +
              '</div>'
            );
          }
          function brandIconTiny(name, iconUrl, accentRgb) {
            return '<img src="' + escapeHtml(String(iconUrl || '')) + '" alt="' + escapeHtml(String(name || '')) + '" class="dm-brand-icon" />';
          }
          function metric(label, valueHtml) {
            return (
              '<div class="dm-metric">' +
                '<div class="dm-metric-label">' + escapeHtml(label) + '</div>' +
                '<div class="dm-metric-value">' + (valueHtml || '\u2014') + '</div>' +
              '</div>'
            );
          }
          function rowKV(label, valueHtml, noteHtml) {
            return (
              '<div class="dm-row-kv">' +
                '<div class="dm-k">' + escapeHtml(label) + '</div>' +
                '<div class="dm-v">' + (valueHtml || '\u2014') + '</div>' +
              '</div>' +
              (noteHtml ? ('<div class="dm-row-kv-note">' + noteHtml + '</div>') : '')
            );
          }
          function diffSpan(n, fmtAbsFn, unitSuffix) {
            if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
            const abs = Math.abs(n);
            const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
            const core = fmtAbsFn ? fmtAbsFn(abs) : String(abs);
            const tone = Math.abs(n) < 0.0001 ? 'ok' : 'warn';
            const text = sign + core + (unitSuffix || '');
            return pillInline(text, tone);
          }


          const headerMetaBits = [];
          if (shopify && shopify.shop) headerMetaBits.push('Shop ' + codeInline(shopify.shop));
          if (c && c.timeZone) headerMetaBits.push('TZ ' + codeInline(String(c.timeZone)));
          headerMetaBits.push('Updated ' + codeInline(formatTs(c && c.now ? c.now : Date.now())));

          const aiCopyGeneratedAt = new Date().toISOString();
          let aiCopyText = '';
          try {
            const convertedSessionsSource = (evSessions != null)
              ? 'sales.evidence.today.checkoutCompletedSessions'
              : (truthCheckoutOrders != null ? 'sales.truth.today.checkoutOrderCount (fallback)' : (truthOrders != null ? 'sales.truth.today.orderCount (fallback)' : 'unknown'));
            const aiPayload = {
              kind: 'kexo_diagnostics_v1',
              generatedAt: aiCopyGeneratedAt,
              page: {
                href: (typeof window !== 'undefined' && window.location) ? window.location.href : '',
              },
              browser: {
                userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '',
                language: (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : '',
              },
              aiNotes: [
                'Truth = Shopify Orders API cache (orders_shopify). This is authoritative.',
                'Evidence = Web Pixel checkout_completed events (purchase_events). Evidence < Truth usually means missing pixel events (consent/adblock/checkout surface) or non-storefront orders.',
                'Kexo derived = purchases built from evidence; if derived matches evidence, drift is upstream of purchases.',
                'Inspect rawConfigStatus.sales.missingEvidence.today.missingOrdersSample for a sample of truth orders missing evidence.',
              ],
              computed: {
                sessions: {
                  shopifyToday: shopifySessionsToday,
                  kexoHumanToday: kexoSessionsToday,
                  diff: sessionsDiff,
                },
                conversions: {
                  definition: 'Shopify CR% uses ShopifyQL conversion_rate; Kexo CR% uses truth orders / sessions * 100',
                  shopifyCrSource,
                  convertedSessionsSource,
                  shopifyCrPct: shopifyCr,
                  kexoCrPct: kexoCr,
                  crDiffPctPoints: crDiff,
                  ordersPerSessionPct: {
                    shopify: shopifyOrderRate,
                    kexo: kexoOrderRate,
                    diffPctPoints: orderRateDiff,
                  },
                },
                truth: {
                  ordersPaidToday: truthOrders,
                  revenueGbpToday: truthRevenue,
                  checkoutTokenOrdersPaidToday: truthCheckoutOrders,
                  checkoutTokenRevenueGbpToday: truthCheckoutRevenue,
                },
                pixelDerived: {
                  ordersToday: pixelDerivedOrders,
                  revenueGbpToday: pixelDerivedRevenue,
                },
                evidence: {
                  checkoutCompletedEventsToday: evTotal,
                  checkoutCompletedSessionsToday: evSessions,
                  linkedEventsToday: evLinked,
                  unlinkedEventsToday: evUnlinked,
                },
                drift: {
                  pixelVsTruthOrders: driftPixelOrders,
                  pixelVsTruthRevenueGbp: driftPixelRevenue,
                  evidenceVsCheckoutTokenOrders: driftEvidenceCheckoutOrders,
                },
                salesEvidence: {
                  evidenceCoveragePct: (truthCheckoutOrders != null && truthCheckoutOrders > 0 && evTotal != null) ? ((evTotal / truthCheckoutOrders) * 100) : null,
                  missingEvidenceOrderCount: missingEvidenceCount,
                  missingEvidenceSample: (missingEvidenceSample && missingEvidenceSample.length) ? missingEvidenceSample.slice(0, 25) : [],
                },
                pixel: {
                  shopifyWebPixelOk: (pixel && typeof pixel.ok === 'boolean') ? pixel.ok : null,
                  shopifyWebPixelInstalled: (pixel && typeof pixel.installed === 'boolean') ? pixel.installed : null,
                  pixelIngestUrl,
                  expectedIngestUrl,
                  ingestUrlMatch,
                },
                settings: {
                  pixelSessionMode,
                  sharedSessionFixEnabled,
                },
              },
              rawConfigStatus: c,
            };
            aiCopyText =
              'Kexo diagnostics (paste this for AI)\n' +
              'Generated: ' + aiCopyGeneratedAt + '\n' +
              (shopify && shopify.shop ? ('Shop: ' + shopify.shop + '\n') : '') +
              '\n```json\n' + JSON.stringify(aiPayload, null, 2) + '\n```\n';
          } catch (err) {
            aiCopyText = 'Kexo diagnostics (AI)\nGenerated: ' + aiCopyGeneratedAt + '\nError building payload: ' + (err && err.message ? String(err.message) : String(err)) + '\n';
          }

          const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

          // SVG icons for tabs
          var tabIcons = {
            sales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
            compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
            traffic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
            pixel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
            googleads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
            shopify: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
            sources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
            system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
            defs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'
          };

          function diagTab(key, label) {
            return '<button type="button" class="dm-tab-btn" data-diag-tab="' + escapeHtml(key) + '" aria-selected="false">' +
              (tabIcons[key] ? tabIcons[key] : '') +
              '<span>' + escapeHtml(label) + '</span>' +
            '</button>';
          }
          function diagTabPanel(key, innerHtml) {
            return '<div class="dm-tab-panel" data-diag-panel="' + escapeHtml(key) + '">' + (innerHtml || '') + '</div>';
          }

          let html = '';
          html += '<div id="be-diag-root" class="dm-root">';

          // ── HERO SECTION: comparison cards + bots (outside tabs) ──
          html += '<div class="dm-hero-section">';
          html +=   '<div class="dm-compare-row">';
          // Shopify card
          html +=     '<div class="dm-compare-card">';
          html +=       '<div class="dm-compare-card-head">';
          html +=         '<img class="dm-compare-card-icon" src="' + escapeHtml(SHOPIFY_LOGO_URL) + '" alt="Shopify" />';
          html +=         '<div><div class="dm-compare-card-title">Shopify</div></div>';
          html +=       '</div>';
          html +=       '<div class="dm-metrics">' +
                            metric('Sessions (today)', fmtSessions(shopifySessionsToday)) +
                            metric('CR%', fmtPct(shopifyCr)) +
                            metric('Orders (paid)', truthOrders != null ? escapeHtml(String(truthOrders)) : '\u2014') +
                            metric('Revenue (paid)', fmtRevenue(truthRevenue)) +
                          '</div>';
          html +=     '</div>';
          // Kexo card
          html +=     '<div class="dm-compare-card">';
          html +=       '<div class="dm-compare-card-head">';
          html +=         '<img class="dm-compare-card-icon" src="' + escapeHtml(KEXO_LOGO_URL) + '" alt="Kexo" />';
          html +=         '<div><div class="dm-compare-card-title">Kexo</div></div>';
          html +=       '</div>';
          html +=       '<div class="dm-metrics">' +
                            metric('Sessions (human, today)', fmtSessions(kexoSessionsToday)) +
                            metric('CR%', fmtPct(kexoCr)) +
                            metric('Orders (paid)', truthOrders != null ? escapeHtml(String(truthOrders)) : '\u2014') +
                            metric('Revenue (paid)', fmtRevenue(truthRevenue)) +
                          '</div>';
          html +=       '<div class="dm-bots-stat">Bots blocked today: <span class="dm-bots-stat-value">' + (botsBlockedToday != null ? fmtSessions(botsBlockedToday) : '\u2014') + '</span></div>';
          html +=     '</div>';
          html +=   '</div>'; // dm-compare-row
          html += '</div>'; // dm-hero-section

          // Compare
          let compare = '';
          compare += card('Comparison (today)', (
            '<div class="dm-table-wrap">' +
              '<div class="dm-table" role="table" aria-label="Comparison">' +
                '<div class="dm-table-row">' +
                  '<div class="dm-table-cell">Item</div>' +
                  '<div class="dm-table-cell"><span class="dm-table-cell-icon-wrap">' + brandIconTiny('Shopify', SHOPIFY_LOGO_URL, '149,191,71') + '<span>Shopify</span></span></div>' +
                  '<div class="dm-table-cell"><span class="dm-table-cell-icon-wrap">' + brandIconTiny('Kexo', KEXO_LOGO_URL, '13,148,136') + '<span>Kexo</span></span></div>' +
                  '<div class="dm-table-cell">Diff</div>' +
                '</div>' +
                '<div class="dm-table-row">' +
                  '<div class="dm-table-cell">Sessions</div>' +
                  '<div class="dm-table-cell">' + fmtSessions(shopifySessionsToday) + '</div>' +
                  '<div class="dm-table-cell">' + fmtSessions(kexoSessionsToday) + '</div>' +
                  '<div class="dm-table-cell">' + (sessionsDiff == null ? '\u2014' : diffSpan(sessionsDiff, function(a){ return formatSessions(a); }, '')) + '</div>' +
                '</div>' +
                '<div class="dm-table-row">' +
                  '<div class="dm-table-cell">Conversion rate</div>' +
                  '<div class="dm-table-cell">' + fmtPct(shopifyCr) + '</div>' +
                  '<div class="dm-table-cell">' + fmtPct(kexoCr) + '</div>' +
                  '<div class="dm-table-cell">' + (crDiff == null ? '\u2014' : diffSpan(crDiff, function(a){ const s=(Math.round(a*10)/10).toFixed(1).replace(/\\.0$/,''); return s; }, 'pp')) + '</div>' +
                '</div>' +
              '</div>' +
            '</div>'
          ));
          if (missingScopes.length) {
            compare += '<div class="dm-hint dm-mt">' + escapeHtml('Missing scopes: re-open the app from Shopify Admin to re-authorize and grant the missing scopes.') + '</div>';
          }
          if (evidenceExpected != null && evidenceExpected > 0 && evTotal === 0) {
            compare += '<div class="dm-hint dm-mt">Evidence can be 0 right after reinstall/pixel creation; it only starts counting from the next checkout.</div>';
          }

          // Sales
          let salesPanel = '';
          salesPanel += '<div class="dm-grid">';
          salesPanel += card('Quick drift', (
            rowKV('Pixel vs truth orders', driftPixelOrders == null ? '\u2014' : codeInline((driftPixelOrders >= 0 ? '+' : '') + String(driftPixelOrders))) +
            rowKV('Pixel vs truth revenue', driftPixelRevenue == null ? '\u2014' : codeInline('\u00a3' + (driftPixelRevenue >= 0 ? '+' : '') + String(driftPixelRevenue))) +
            rowKV('Evidence vs checkout-token', driftEvidenceCheckoutOrders == null ? '\u2014' : codeInline((driftEvidenceCheckoutOrders >= 0 ? '+' : '') + String(driftEvidenceCheckoutOrders)))
          ));
          salesPanel += card('Truth (paid)', (
            rowKV('Orders', truthOrders != null ? codeInline(String(truthOrders)) : '\u2014') +
            rowKV('Revenue', truthRevenue != null ? codeInline(formatRevenue(truthRevenue)) : '\u2014') +
            rowKV('Checkout-token orders', truthCheckoutOrders != null ? codeInline(String(truthCheckoutOrders)) : '\u2014') +
            rowKV('Checkout-token revenue', truthCheckoutRevenue != null ? codeInline(formatRevenue(truthCheckoutRevenue)) : '\u2014')
          ));
          salesPanel += card('Pixel (derived)', (
            rowKV('Derived orders', pixelDerivedOrders != null ? codeInline(String(pixelDerivedOrders)) : '\u2014') +
            rowKV('Derived revenue', pixelDerivedRevenue != null ? codeInline(formatRevenue(pixelDerivedRevenue)) : '\u2014') +
            rowKV('Drift vs truth (orders)', driftPixelOrders == null ? '\u2014' : codeInline((driftPixelOrders >= 0 ? '+' : '') + String(driftPixelOrders))) +
            rowKV('Drift vs truth (revenue)', driftPixelRevenue == null ? '\u2014' : codeInline('\u00a3' + (driftPixelRevenue >= 0 ? '+' : '') + String(driftPixelRevenue)))
          ));
          salesPanel += '</div>';
          salesPanel += '<div class="dm-grid dm-mt">';
          salesPanel += card('Evidence (checkout_completed)', (
            rowKV('Events (today)', evTotal != null ? codeInline(String(evTotal)) : '\u2014') +
            rowKV('Converted sessions (today)', evSessions != null ? codeInline(String(evSessions)) : '\u2014') +
            rowKV('Linked / unlinked', (evLinked != null && evUnlinked != null) ? (codeInline(String(evLinked)) + ' linked · ' + codeInline(String(evUnlinked)) + ' unlinked') : '\u2014') +
            (typeof evidenceToday.lastOccurredAt === 'number' ? rowKV('Last event', codeInline(formatTs(evidenceToday.lastOccurredAt))) : '')
          ));
          salesPanel += card('Returning', (
            rowKV('Returning customers', truthReturningCustomers != null ? codeInline(String(truthReturningCustomers)) : '\u2014') +
            rowKV('Returning revenue', truthReturningRevenue != null ? codeInline(formatRevenue(truthReturningRevenue)) : '\u2014')
          ));
          salesPanel += '</div>';

          // AI + future-agent guidance: interpret truth vs evidence drift
          try {
            const denomForCoverage = (truthCheckoutOrders != null ? truthCheckoutOrders : truthOrders);
            const missingOrders = (typeof missingEvidenceCount === 'number')
              ? missingEvidenceCount
              : ((denomForCoverage != null && evTotal != null) ? Math.max(0, denomForCoverage - evTotal) : null);
            const coveragePct = (denomForCoverage != null && denomForCoverage > 0 && evTotal != null)
              ? (evTotal / denomForCoverage) * 100
              : null;
            const cov = (coveragePct != null) ? (Math.round(coveragePct * 10) / 10) : null;
            const covTone = (cov == null) ? 'warn' : (cov >= 95 ? 'ok' : (cov >= 80 ? 'warn' : 'bad'));

            function missingLine(o) {
              if (!o || typeof o !== 'object') return '';
              const bits = [];
              const on = o.order_name != null ? String(o.order_name).trim() : '';
              const oid = o.order_id != null ? String(o.order_id).trim() : '';
              const ca = (o.created_at != null && isFinite(Number(o.created_at))) ? Number(o.created_at) : null;
              const src = o.source_name != null ? String(o.source_name).trim() : '';
              const refh = o.referring_site_host != null ? String(o.referring_site_host).trim() : '';
              const landh = o.landing_site_host != null ? String(o.landing_site_host).trim() : '';
              const gw = o.gateway != null ? String(o.gateway).trim() : '';
              if (on) bits.push(escapeHtml(on));
              if (oid) bits.push('id ' + escapeHtml(oid));
              if (ca != null) bits.push(escapeHtml(formatTs(ca)));
              if (src) bits.push('source=' + escapeHtml(src));
              if (landh) bits.push('landing=' + escapeHtml(landh));
              if (refh) bits.push('ref=' + escapeHtml(refh));
              if (gw) bits.push('gateway=' + escapeHtml(gw));
              if (!bits.length) return '';
              return '<div class="dm-missing-line">' + bits.join(' · ') + '</div>';
            }

            let missingSampleHtml = '';
            if (missingEvidenceSample && missingEvidenceSample.length) {
              const lines = missingEvidenceSample.slice(0, 25).map(missingLine).filter(Boolean).join('');
              missingSampleHtml =
                '<details class="dm-missing-details">' +
                  '<summary>Missing evidence orders (sample ' + escapeHtml(String(missingEvidenceSample.length)) + ')</summary>' +
                  '<div class="dm-def-details-body">' + (lines || '<div class="dm-def-note">No sample rows.</div>') + '</div>' +
                  '<div class="dm-hint">If these are mostly <code class="dm-code">source=web</code> but still missing evidence, it’s usually adblock/consent or pixel not running on the completion surface. If they’re <code class="dm-code">source=pos</code> / manual / subscription renewals, pixel evidence won’t exist.</div>' +
                '</details>';
            }

            const guide =
              '<div class="dm-guide dm-hint">' +
                '<div class="dm-guide-title">How to debug sales drift (Truth vs Kexo)</div>' +
                '<ul>' +
                  '<li><strong>Truth</strong> = Shopify Orders API cache (`orders_shopify`, paid, not cancelled). This is the authoritative number.</li>' +
                  '<li><strong>Evidence</strong> = Web Pixel <code class="dm-code">checkout_completed</code> events (`purchase_events`). If Evidence &lt; Truth, events are missing (capture issue), not a truth sync issue.</li>' +
                  '<li><strong>Kexo derived</strong> = `purchases` (built from evidence). If it matches Evidence (as it does when linked/unlinked looks healthy), drift is upstream of purchases.</li>' +
                  '<li>First check: pixel installed + ingestUrl match, and Evidence linked/unlinked (linking health). Then inspect the Missing Evidence sample below.</li>' +
                '</ul>' +
              '</div>';

            salesPanel += '<div class="dm-mt">' + card('Sales drift (AI notes)', (
              rowKV('Coverage (evidence / truth)', (evTotal != null && denomForCoverage != null)
                ? (codeInline(String(evTotal)) + ' / ' + codeInline(String(denomForCoverage)) + ' ' + pillInline((cov != null ? (cov + '%') : '\u2014') + ' evidence', covTone))
                : '\u2014'
              ) +
              rowKV('Missing evidence (count)', missingOrders == null ? '\u2014' : pillInline(String(missingOrders), missingOrders === 0 ? 'ok' : (missingOrders <= 3 ? 'warn' : 'bad'))) +
              (missingEvidenceNote ? ('<div class="dm-hint">' + escapeHtml(missingEvidenceNote) + '</div>') : '') +
              guide +
              (missingSampleHtml || '')
            )) + '</div>';
          } catch (_) {}

          // Traffic
          let trafficPanel = '';
          trafficPanel += '<div class="dm-grid">';
          trafficPanel += card('Sessions', (
            (traffic && traffic.today && typeof traffic.today.sessionsReachedApp === 'number' ? rowKV('Reached app (today)', codeInline(formatSessions(traffic.today.sessionsReachedApp))) : '') +
            (traffic && traffic.today && typeof traffic.today.humanSessions === 'number' ? rowKV('Human sessions (today)', codeInline(formatSessions(traffic.today.humanSessions))) : '') +
            (traffic && traffic.today && typeof traffic.today.botSessionsTagged === 'number' ? rowKV('Bot sessions tagged (today)', codeInline(formatSessions(traffic.today.botSessionsTagged))) : '') +
            (traffic && traffic.today && typeof traffic.today.totalTrafficEst === 'number' ? rowKV('Total traffic est. (today)', codeInline(formatSessions(traffic.today.totalTrafficEst)), 'Total traffic est. = sessions reached app + bots blocked at edge.') : '')
          ));
          let shopifySessionsNote = '';
          if (typeof traffic.shopifySessionsToday === 'number') {
            shopifySessionsNote += rowKV('Shopify sessions (today)', codeInline(formatSessions(traffic.shopifySessionsToday)));
            if (traffic && traffic.today && typeof traffic.today.humanSessions === 'number') {
              shopifySessionsNote += rowKV('Shopify − ours (human)', codeInline(formatSessions(traffic.shopifySessionsToday - traffic.today.humanSessions)));
            }
          } else if (traffic.shopifySessionsTodayNote) {
            shopifySessionsNote += rowKV('Shopify sessions (today)', '\u2014', escapeHtml(traffic.shopifySessionsTodayNote));
          }
          trafficPanel += card('Shopify vs ours', shopifySessionsNote || rowKV('Shopify sessions (today)', '\u2014'));
          trafficPanel += card('Traffic tab settings', (
            '<div class="dm-def-section-title">Channels</div>' +
            '<div id="traffic-sources-picker" class="traffic-picker-list"><div class="dm-def-note">Loading…</div></div>' +
            '<div class="dm-def-section-title">Device types</div>' +
            '<div id="traffic-types-picker" class="traffic-picker-list"><div class="dm-def-note">Loading…</div></div>' +
            '<div class="dm-def-note">These controls replace the Traffic tab table settings icons.</div>'
          ));
          trafficPanel += '</div>';

          // Pixel
          let pixelPanel = '';
          pixelPanel += '<div class="dm-grid">';
          pixelPanel += card('Pixel (Shopify)', (
            rowKV('Installed', pixel && pixel.installed === true ? pillInline('Yes', 'ok') : (pixel && pixel.installed === false ? pillInline('No', 'bad') : '\u2014')) +
            (pixel && pixel.message ? rowKV('Status', codeInline(pixel.message)) : '') +
            (pixelIngestUrl ? rowKV('Pixel ingestUrl', codeInline(pixelIngestUrl)) : '') +
            (expectedIngestUrl ? rowKV('Expected ingestUrl', codeInline(expectedIngestUrl)) : '') +
            (ingestUrlMatch == null ? '' : rowKV('IngestUrl match', ingestUrlMatch ? pillInline('Match', 'ok') : pillInline('Mismatch', 'bad')))
          ));
          pixelPanel += card('Session mode (beta)', (
            '<label class="dm-toggle-row">' +
              '<input type="checkbox" id="pixel-session-mode-toggle"' + (sharedSessionFixEnabled ? ' checked' : '') + ' />' +
              '<span>Share session across tabs (30m inactivity)</span>' +
            '</label>' +
            '<div class="dm-hint">Auto-saves. ON shares one session across tabs (30m inactivity) to reduce inflated session counts. OFF uses legacy per-tab sessions.</div>' +
            '<div id="pixel-session-mode-msg" class="dm-toggle-msg"></div>'
          ));
          pixelPanel += '</div>';

          // Shopify
          let shopifyPanel = '';
          shopifyPanel += '<div class="dm-grid">';
          shopifyPanel += card('Auth + scopes', (
            rowKV('Shop', shopify.shop ? codeInline(shopify.shop) : pillInline('Missing', 'bad')) +
            rowKV('Token stored', shopify.hasToken ? pillInline('Yes', 'ok') : pillInline('No', 'bad')) +
            (storedScopesStr ? rowKV('Stored scopes', codeInline(storedScopesStr)) : '') +
            (serverScopesStr ? rowKV('Required scopes', codeInline(serverScopesStr)) : '') +
            (missingScopes.length ? rowKV('Missing scopes', codeInline(missingScopes.join(', '))) : rowKV('Missing scopes', pillInline('None', 'ok')))
          ));
          shopifyPanel += card('Truth sync health', (
            rowKV('Sync age', staleSec != null ? codeInline(staleSec + 's') : '\u2014') +
            (health && health.lastSuccessAt ? rowKV('Last sync', codeInline(formatTs(health.lastSuccessAt))) : '') +
            (health && health.lastError ? rowKV('Last error', codeInline(String(health.lastError).slice(0, 220))) : '') +
            (typeof truthToday.lastOrderCreatedAt === 'number' ? rowKV('Last order', codeInline(formatTs(truthToday.lastOrderCreatedAt))) : '')
          ));
          shopifyPanel += '</div>';

          // Sources
          let sourcesPanel = '';
          sourcesPanel += card('Traffic source mapping', (
            '<div class="dm-hint">Map URL UTMs into custom sources + icons (affects Traffic + Home source icons). Unmapped tokens appear first.</div>' +
            '<div id="traffic-source-mapping-root"><div class="dm-loading">Loading…</div></div>'
          ));

          // Google Ads
          let googleAdsPanel = '';
          try {
            const ads = c && c.ads ? c.ads : {};
            const adsStatus = ads && ads.status ? ads.status : null;
            const providers = (adsStatus && Array.isArray(adsStatus.providers)) ? adsStatus.providers : [];
            const g = providers.find(function(p) { return p && String(p.key || '').toLowerCase() === 'google_ads'; }) || null;
            const connected = g && g.connected === true;
            const configured = g && g.configured === true;
            const customerId = (g && g.customerId) ? String(g.customerId) : '';
            const loginCustomerId = (g && g.loginCustomerId) ? String(g.loginCustomerId) : '';
            const hasRefreshToken = g && g.hasRefreshToken === true;
            const hasDeveloperToken = g && g.hasDeveloperToken === true;
            const hasAdsDb = g && g.adsDb === true;
            const apiVer = (ads && typeof ads.googleAdsApiVersion === 'string') ? ads.googleAdsApiVersion : '';

            function prettyJson(obj) {
              try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj || ''); }
            }

            googleAdsPanel += '<div class="dm-grid">';
            googleAdsPanel += card('Connection', (
              rowKV('Configured', configured ? pillInline('Yes', 'ok') : pillInline('No', 'bad')) +
              rowKV('Connected (refresh_token)', connected ? pillInline('Yes', 'ok') : pillInline('No', 'bad')) +
              rowKV('ADS DB', hasAdsDb ? pillInline('OK', 'ok') : pillInline('Missing', 'bad')) +
              (customerId ? rowKV('Customer ID', codeInline(customerId)) : '') +
              (loginCustomerId ? rowKV('Login Customer ID', codeInline(loginCustomerId)) : '') +
              rowKV('Developer token', hasDeveloperToken ? pillInline('Set', 'ok') : pillInline('Missing', 'bad')) +
              rowKV('Refresh token', hasRefreshToken ? pillInline('Present', 'ok') : pillInline('Missing', 'bad')) +
              (apiVer ? rowKV('API version hint', codeInline(apiVer)) : rowKV('API version hint', pillInline('Auto', 'ok')))
            ));

            const connectUrl = '/api/ads/google/connect?redirect=' + encodeURIComponent('/app/live-visitors');
            googleAdsPanel += card('Actions', (
              '<div class="dm-bar-actions" style="justify-content:flex-start;">' +
                '<a class="dm-copy-btn" href="' + escapeHtml(connectUrl) + '" title="Connect Google Ads (OAuth)">' + copyIcon + '<span>Connect</span></a>' +
                '<button type="button" id="ga-status-btn" class="dm-copy-btn" title="Fetch /api/ads/status">' + copyIcon + '<span>Status</span></button>' +
                '<button type="button" id="ga-summary-btn" class="dm-copy-btn" title="Fetch /api/ads/summary?range=7d">' + copyIcon + '<span>Summary</span></button>' +
                '<button type="button" id="ga-refresh-7d-btn" class="dm-copy-btn" title="POST /api/ads/refresh?range=7d">' + copyIcon + '<span>Refresh 7d</span></button>' +
                '<button type="button" id="ga-refresh-month-btn" class="dm-copy-btn" title="POST /api/ads/refresh?range=month">' + copyIcon + '<span>Refresh month</span></button>' +
                '<span id="ga-msg" class="dm-copy-msg"></span>' +
              '</div>' +
              '<div class="dm-hint">Refresh returns spend sync diagnostics including per-version attempts when Google Ads REST errors occur.</div>'
            ));

            googleAdsPanel += card('Output', (
              '<pre id="ga-output" class="dm-json-pre">' + escapeHtml(prettyJson({ ads: adsStatus })) + '</pre>'
            ));
            googleAdsPanel += '</div>';
          } catch (err) {
            googleAdsPanel = '<div class="dm-error">' + pillInline('Error', 'bad') + '<span>Google Ads diagnostics failed to render.</span></div>';
          }

          // System
          let systemPanel = '';
          systemPanel += '<div class="dm-grid">';
          systemPanel += card('Reporting', (
            (reporting && (reporting.ordersSource || reporting.sessionsSource))
              ? (
                (reporting.ordersSource ? rowKV('Orders source', codeInline(reporting.ordersSource)) : '') +
                (reporting.sessionsSource ? rowKV('Sessions source', codeInline(reporting.sessionsSource)) : '')
              )
              : rowKV('Sources', '\u2014')
          ));
          let tablesLine = '';
          if (db && db.tables) {
            const t = db.tables;
            const bits = [];
            function add(name, ok) { bits.push(name + (ok ? ' ✓' : ' ✗')); }
            add('settings', !!t.settings);
            add('shop_sessions', !!t.shop_sessions);
            add('visitors', !!t.visitors);
            add('sessions', !!t.sessions);
            add('events', !!t.events);
            add('purchases', !!t.purchases);
            add('orders_shopify', !!t.orders_shopify);
            add('orders_shopify_line_items', !!t.orders_shopify_line_items);
            add('customer_order_facts', !!t.customer_order_facts);
            add('purchase_events', !!t.purchase_events);
            add('reconcile_state', !!t.reconcile_state);
            add('reconcile_snapshots', !!t.reconcile_snapshots);
            add('shopify_sessions_snapshots', !!t.shopify_sessions_snapshots);
            add('audit_log', !!t.audit_log);
            add('bot_block_counts', !!t.bot_block_counts);
            tablesLine = codeInline(bits.join(' · '));
          }
          systemPanel += card('Runtime', (
            (app && app.version ? rowKV('App version', codeInline(app.version)) : '') +
            (db && db.engine ? rowKV('DB', codeInline(db.engine + (db.configured ? '' : ' (DB_URL not set)'))) : '') +
            (tablesLine ? rowKV('Tables', tablesLine) : '') +
            (app && typeof app.sentryConfigured === 'boolean' ? rowKV('Sentry', app.sentryConfigured ? pillInline('ON', 'ok') : pillInline('OFF', 'bad')) : '')
          ));
          systemPanel += '</div>';

          // Definitions (reuse existing renderer for content, but in its own top-level tab)
          let defsPanel = '';
          defsPanel += card('Metric + table definitions', renderTrackerDefinitions(trackerDefinitions));

          // ── TAB BAR ──
          html += '<div class="dm-tabs-bar" id="be-diag-tabs">';
          html +=   diagTab('sales', 'Sales');
          html +=   diagTab('compare', 'Compare');
          html +=   diagTab('traffic', 'Traffic');
          html +=   diagTab('pixel', 'Pixel');
          html +=   diagTab('googleads', 'Google Ads');
          html +=   diagTab('shopify', 'Shopify');
          html +=   diagTab('sources', 'Sources');
          html +=   diagTab('system', 'System');
          html +=   diagTab('defs', 'Definitions');
          html += '</div>';

          // Advanced copy dropdown — inside first tab panel but logically separate
          var advancedDropdown = '<details class="dm-copy-dropdown">';
          advancedDropdown += '<summary class="dm-copy-dropdown-summary">Advanced</summary>';
          advancedDropdown += '<div class="dm-copy-dropdown-body"><div class="dm-bar-row">';
          advancedDropdown +=   '<div class="dm-bar-meta">' + headerMetaBits.join(' · ') + '</div>';
          advancedDropdown +=   '<div class="dm-bar-actions">' +
                       '<button type="button" id="be-copy-ai-btn" class="dm-copy-btn" title="Copy a detailed diagnostics payload for AI">' + copyIcon + '<span>Copy AI debug</span></button>' +
                       '<a href="/auth/google?redirect=/app/live-visitors" class="dm-copy-btn" title="Sign in again with Google if your session expires">' + copyIcon + '<span>Re-login</span></a>' +
                       '<span id="be-copy-ai-msg" class="dm-copy-msg"></span>' +
                       (shopify && shopify.hasToken ? pillInline('Token OK', 'ok') : pillInline('Token missing', 'bad')) +
                       (missingScopes.length ? pillInline('Missing scopes', 'bad') : pillInline('Scopes OK', 'ok')) +
                     '</div>';
          advancedDropdown += '</div></div></details>';

          // ── TAB PANELS ──
          html += diagTabPanel('sales', advancedDropdown + salesPanel);
          html += diagTabPanel('compare', compare);
          html += diagTabPanel('traffic', trafficPanel);
          html += diagTabPanel('pixel', pixelPanel);
          html += diagTabPanel('googleads', googleAdsPanel);
          html += diagTabPanel('shopify', shopifyPanel);
          html += diagTabPanel('sources', sourcesPanel);
          html += diagTabPanel('system', systemPanel);
          html += diagTabPanel('defs', defsPanel);

          html += '</div>'; // be-diag-root

          const configStatusEl = document.getElementById('config-status');
          if (configStatusEl) configStatusEl.innerHTML = html;

          // ── Wire up tab switching ──
          (function initDiagTabs() {
            var tabBar = document.getElementById('be-diag-tabs');
            if (!tabBar) return;
            var btns = tabBar.querySelectorAll('.dm-tab-btn[data-diag-tab]');
            function activateTab(key) {
              try { activeDiagTabKey = key; } catch (_) {}
              btns.forEach(function(b) { b.setAttribute('aria-selected', b.getAttribute('data-diag-tab') === key ? 'true' : 'false'); });
              document.querySelectorAll('.dm-tab-panel[data-diag-panel]').forEach(function(p) {
                p.classList.toggle('dm-tab-panel--active', p.getAttribute('data-diag-panel') === key);
              });
            }
            btns.forEach(function(b) {
              b.addEventListener('click', function() { activateTab(b.getAttribute('data-diag-tab')); });
            });
            // Default: restore previously-selected tab (best-effort), else first.
            if (btns.length) {
              var preferred = (typeof activeDiagTabKey === 'string' && activeDiagTabKey) ? activeDiagTabKey : '';
              var exists = false;
              btns.forEach(function(b) { if (b.getAttribute('data-diag-tab') === preferred) exists = true; });
              activateTab(exists ? preferred : btns[0].getAttribute('data-diag-tab'));
            }
          })();

          // Preserve scroll position when refreshing while the modal is already open.
          try {
            if (preserveView && modalCardEl) modalCardEl.scrollTop = prevModalScrollTop;
          } catch (_) {}
          try {
            const compareIsOpenNow = !!(compareModalEl && compareModalEl.classList.contains('open'));
            if (compareIsOpenNow && compareStatusEl) {
              const updatedAtMs = (c && typeof c.now === 'number' && isFinite(c.now)) ? c.now : Date.now();

              function kickerForKey(key) {
                const k = key ? String(key).trim().toLowerCase() : '';
                if (k === 'sessions') return 'Sessions';
                if (k === 'aov') return 'AOV';
                return 'Conversion rate';
              }

              const compareKey = activeKpiCompareKey ? String(activeKpiCompareKey).trim().toLowerCase() : 'conv';
              if (compareKickerEl) compareKickerEl.textContent = kickerForKey(compareKey);

              function compareMetric(label, valueHtml) {
                return (
                  '<div class="kpi-compare-metric">' +
                    '<div class="kpi-compare-metric-label">' + escapeHtml(label) + '</div>' +
                    '<div class="kpi-compare-metric-value">' + (valueHtml || '\u2014') + '</div>' +
                  '</div>'
                );
              }
              function compareBrand(name, logoUrl, sub, rightHtml) {
                const right = rightHtml ? String(rightHtml) : '';
                return (
                  '<div class="kpi-compare-brand">' +
                    '<div class="kpi-compare-brand-left">' +
                      '<img class="kpi-compare-brand-icon" src="' + escapeHtml(String(logoUrl || '')) + '" width="28" height="28" alt="" aria-hidden="true" decoding="async" />' +
                      '<div class="kpi-compare-brand-text">' +
                        '<div class="kpi-compare-brand-name">' + escapeHtml(name || '') + '</div>' +
                        '<div class="kpi-compare-brand-sub">' + escapeHtml(sub || '') + '</div>' +
                      '</div>' +
                    '</div>' +
                    (right ? ('<div class="kpi-compare-brand-right">' + right + '</div>') : '') +
                  '</div>'
                );
              }
              function inlineMetric(label, valueHtml) {
                return (
                  '<span class="kpi-compare-inline-metric">' +
                    '<span class="kpi-compare-inline-label">' + escapeHtml(label || '') + '</span>' +
                    '<span class="kpi-compare-inline-value">' + (valueHtml || '\u2014') + '</span>' +
                  '</span>'
                );
              }

              function fmtSignedCount(v) {
                if (typeof v !== 'number' || !isFinite(v)) return '';
                const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
                return sign + formatSessions(Math.abs(v));
              }
              function fmtSignedMoney(v) {
                if (typeof v !== 'number' || !isFinite(v)) return '';
                const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
                return sign + formatRevenue(Math.abs(v));
              }
              function fmtSignedPp(v) {
                if (typeof v !== 'number' || !isFinite(v)) return '';
                const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
                const abs = Math.abs(v);
                const s = (Math.round(abs * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
                return sign + s + 'pp';
              }
              function safeAov(revenue, orders) {
                if (typeof revenue !== 'number' || !isFinite(revenue)) return null;
                if (typeof orders !== 'number' || !isFinite(orders) || orders <= 0) return null;
                return revenue / orders;
              }

              const botsTaggedToday = (traffic && traffic.today && typeof traffic.today.botSessionsTagged === 'number')
                ? traffic.today.botSessionsTagged
                : null;
              const totalTrafficEstToday = (traffic && traffic.today && typeof traffic.today.totalTrafficEst === 'number')
                ? traffic.today.totalTrafficEst
                : null;
              const sessionsReachedAppToday = (traffic && traffic.today && typeof traffic.today.sessionsReachedApp === 'number')
                ? traffic.today.sessionsReachedApp
                : null;

              const truthAov = safeAov(truthRevenue, truthOrders);
              const pixelAov = safeAov(pixelDerivedRevenue, pixelDerivedOrders);

              let diffText = '';
              if (compareKey === 'sessions') {
                const d = (kexoSessionsToday != null && shopifySessionsToday != null) ? (kexoSessionsToday - shopifySessionsToday) : null;
                diffText = (d != null) ? ('Δ Sessions ' + fmtSignedCount(d)) : '';
              } else if (compareKey === 'aov') {
                const d = (pixelAov != null && truthAov != null) ? (pixelAov - truthAov) : null;
                diffText = (d != null) ? ('Δ AOV ' + fmtSignedMoney(d)) : '';
              } else {
                const d = (kexoCr != null && shopifyCr != null) ? (kexoCr - shopifyCr) : null;
                diffText = (d != null) ? ('Δ CR ' + fmtSignedPp(d)) : '';
              }

              if (compareUpdatedEl) {
                compareUpdatedEl.textContent = 'Updated ' + formatTs(updatedAtMs) + (diffText ? (' · ' + diffText) : '');
              }

              const ordersHtml = (truthOrders != null) ? escapeHtml(String(truthOrders)) : '\u2014';
              const pixelOrdersHtml = (pixelDerivedOrders != null) ? escapeHtml(String(pixelDerivedOrders)) : '\u2014';
              const missingEvidenceHtml = (typeof missingEvidenceCount === 'number' && isFinite(missingEvidenceCount)) ? escapeHtml(String(missingEvidenceCount)) : '\u2014';
              const evidenceHtml = (typeof evTotal === 'number' && isFinite(evTotal)) ? escapeHtml(String(evTotal)) : '\u2014';

              let cmpHtml = '';
              cmpHtml += '<div class="kpi-compare-grid">';

              if (compareKey === 'sessions') {
                cmpHtml +=   '<div class="kpi-compare-card kpi-compare-card--simple">';
                cmpHtml +=     compareBrand('Shopify', SHOPIFY_LOGO_URL, 'ShopifyQL sessions', inlineMetric('Sessions', fmtSessions(shopifySessionsToday)));
                cmpHtml +=   '</div>';
                cmpHtml +=   '<div class="kpi-compare-card kpi-compare-card--simple">';
                cmpHtml +=     compareBrand('Kexo', KEXO_LOGO_URL, 'Human sessions', inlineMetric('Sessions', fmtSessions(kexoSessionsToday)));
                cmpHtml +=   '</div>';
              } else if (compareKey === 'aov') {
                cmpHtml +=   '<div class="kpi-compare-card kpi-compare-card--simple">';
                cmpHtml +=     compareBrand('Shopify', SHOPIFY_LOGO_URL, 'Paid truth orders', inlineMetric('AOV', fmtRevenue(truthAov)));
                cmpHtml +=   '</div>';
                cmpHtml +=   '<div class="kpi-compare-card kpi-compare-card--simple">';
                cmpHtml +=     compareBrand('Kexo', KEXO_LOGO_URL, 'Pixel purchases (deduped)', inlineMetric('AOV', fmtRevenue(pixelAov)));
                cmpHtml +=   '</div>';
              } else {
                cmpHtml +=   '<div class="kpi-compare-card">';
                cmpHtml +=     compareBrand('Shopify', SHOPIFY_LOGO_URL, 'ShopifyQL sessions · conversion_rate');
                cmpHtml +=     '<div class="kpi-compare-metrics">' +
                                 compareMetric('CR% (Shopify)', fmtPct(shopifyCr)) +
                                 compareMetric('Sessions (today)', fmtSessions(shopifySessionsToday)) +
                                 compareMetric('Orders (paid)', ordersHtml) +
                                 compareMetric('Revenue (paid)', fmtRevenue(truthRevenue)) +
                               '</div>';
                cmpHtml +=   '</div>';
                cmpHtml +=   '<div class="kpi-compare-card">';
                cmpHtml +=     compareBrand('Kexo', KEXO_LOGO_URL, 'Human sessions · bot signals');
                cmpHtml +=     '<div class="kpi-compare-metrics">' +
                                 compareMetric('CR% (truth)', fmtPct(kexoCr)) +
                                 compareMetric('Sessions (human, today)', fmtSessions(kexoSessionsToday)) +
                                 compareMetric('Bots blocked (today)', botsBlockedToday != null ? fmtSessions(botsBlockedToday) : '\u2014') +
                                 compareMetric('Bot-tagged (today)', botsTaggedToday != null ? fmtSessions(botsTaggedToday) : '\u2014') +
                               '</div>';
                cmpHtml +=   '</div>';
              }

              cmpHtml += '</div>';

              compareStatusEl.innerHTML = cmpHtml;
            }
          } catch (_) {}
          try { renderTrafficPickers(trafficCache || null); } catch (_) {}
          try {
            const btn = document.getElementById('be-copy-ai-btn');
            const msg = document.getElementById('be-copy-ai-msg');
            if (btn) {
              btn.onclick = function() {
                const text = aiCopyText || '';
                function setMsg(t, ok) {
                  if (!msg) return;
                  msg.textContent = t || '';
                  msg.classList.remove('dm-copy-msg--success', 'dm-copy-msg--error');
                  msg.classList.add(ok ? 'dm-copy-msg--success' : 'dm-copy-msg--error');
                }
                function fallbackCopy(t) {
                  const ta = document.createElement('textarea');
                  ta.value = t;
                  ta.setAttribute('readonly', 'readonly');
                  ta.style.position = 'fixed';
                  ta.style.top = '-9999px';
                  ta.style.left = '-9999px';
                  document.body.appendChild(ta);
                  ta.select();
                  ta.setSelectionRange(0, ta.value.length);
                  const ok = document.execCommand('copy');
                  document.body.removeChild(ta);
                  return ok;
                }
                try {
                  if (!text) {
                    setMsg('Nothing to copy', false);
                    return;
                  }
                  setMsg('Copying…', true);
                  if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    navigator.clipboard.writeText(text)
                      .then(function() { setMsg('Copied (' + text.length + ' chars)', true); })
                      .catch(function(err) {
                        const ok = fallbackCopy(text);
                        if (ok) setMsg('Copied (' + text.length + ' chars)', true);
                        else setMsg('Copy failed: ' + (err && err.message ? String(err.message) : 'error'), false);
                      });
                  } else {
                    const ok = fallbackCopy(text);
                    if (ok) setMsg('Copied (' + text.length + ' chars)', true);
                    else setMsg('Copy failed', false);
                  }
                } catch (err) {
                  setMsg('Copy failed: ' + (err && err.message ? String(err.message) : 'error'), false);
                }
              };
            }
          } catch (_) {}
          try { initTrafficSourceMappingPanel(); } catch (_) {}
          try {
            function setGaMsg(t, ok) {
              const msgEl = document.getElementById('ga-msg');
              if (!msgEl) return;
              msgEl.textContent = t || '';
              msgEl.classList.remove('dm-copy-msg--success', 'dm-copy-msg--error');
              msgEl.classList.add(ok ? 'dm-copy-msg--success' : 'dm-copy-msg--error');
            }
            function setGaOutput(obj) {
              const outEl = document.getElementById('ga-output');
              if (!outEl) return;
              try { outEl.textContent = JSON.stringify(obj, null, 2); }
              catch (_) { outEl.textContent = String(obj || ''); }
            }
            function fetchJson(url, options) {
              return fetch(url, options || { credentials: 'same-origin', cache: 'no-store' })
                .then(function(r) {
                  return r.text().then(function(t) {
                    let j = null;
                    try { j = t ? JSON.parse(t) : null; } catch (_) {}
                    return { ok: r.ok, status: r.status, json: j, text: t };
                  });
                });
            }
            const statusBtn = document.getElementById('ga-status-btn');
            const summaryBtn = document.getElementById('ga-summary-btn');
            const refresh7dBtn = document.getElementById('ga-refresh-7d-btn');
            const refreshMonthBtn = document.getElementById('ga-refresh-month-btn');
            if (statusBtn) {
              statusBtn.onclick = function() {
                setGaMsg('Fetching status…', true);
                fetchJson((API || '') + '/api/ads/status', { credentials: 'same-origin', cache: 'no-store' })
                  .then(function(r) {
                    setGaOutput({ endpoint: 'GET /api/ads/status', status: r.status, ok: r.ok, body: r.json || r.text });
                    setGaMsg(r.ok ? 'Status OK' : ('Status error ' + r.status), r.ok);
                  })
                  .catch(function(err) {
                    setGaOutput({ endpoint: 'GET /api/ads/status', error: err && err.message ? String(err.message) : 'request_failed' });
                    setGaMsg('Status request failed', false);
                  });
              };
            }
            if (summaryBtn) {
              summaryBtn.onclick = function() {
                setGaMsg('Fetching summary…', true);
                fetchJson((API || '') + '/api/ads/summary?range=7d', { credentials: 'same-origin', cache: 'no-store' })
                  .then(function(r) {
                    setGaOutput({ endpoint: 'GET /api/ads/summary?range=7d', status: r.status, ok: r.ok, body: r.json || r.text });
                    setGaMsg(r.ok ? 'Summary OK' : ('Summary error ' + r.status), r.ok);
                  })
                  .catch(function(err) {
                    setGaOutput({ endpoint: 'GET /api/ads/summary?range=7d', error: err && err.message ? String(err.message) : 'request_failed' });
                    setGaMsg('Summary request failed', false);
                  });
              };
            }
            function doRefresh(rangeKey) {
              setGaMsg('Refreshing ' + rangeKey + '…', true);
              fetchJson((API || '') + '/api/ads/refresh?range=' + encodeURIComponent(rangeKey), {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: 'googleads' }),
              })
                .then(function(r) {
                  setGaOutput({ endpoint: 'POST /api/ads/refresh?range=' + rangeKey, status: r.status, ok: r.ok, body: r.json || r.text });
                  setGaMsg(r.ok ? ('Refresh ' + rangeKey + ' OK') : ('Refresh error ' + r.status), r.ok);
                })
                .catch(function(err) {
                  setGaOutput({ endpoint: 'POST /api/ads/refresh?range=' + rangeKey, error: err && err.message ? String(err.message) : 'request_failed' });
                  setGaMsg('Refresh request failed', false);
                });
            }
            if (refresh7dBtn) refresh7dBtn.onclick = function() { doRefresh('7d'); };
            if (refreshMonthBtn) refreshMonthBtn.onclick = function() { doRefresh('month'); };
          } catch (_) {}
          try {
            const toggle = document.getElementById('pixel-session-mode-toggle');
            const msgEl = document.getElementById('pixel-session-mode-msg');
            if (toggle) {
              toggle.onchange = function() {
                const enabled = !!toggle.checked;
                const nextMode = enabled ? 'shared_ttl' : 'legacy';
                toggle.disabled = true;
                if (msgEl) msgEl.textContent = 'Saving…';
                fetch(API + '/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'same-origin',
                  cache: 'no-store',
                  body: JSON.stringify({ pixelSessionMode: nextMode }),
                })
                  .then(function(r) {
                    if (r.ok) return r.json();
                    return r.json().catch(function() { return null; }).then(function(j) {
                      const msg = j && j.error ? String(j.error) : ('HTTP ' + r.status);
                      throw new Error(msg);
                    });
                  })
                  .then(function() {
                    const shop = getShopParam();
                    if (shop && /\.myshopify\.com$/i.test(shop)) {
                      if (msgEl) msgEl.textContent = 'Saved. Syncing pixel settings…';
                      return fetch(API + '/api/pixel/ensure?shop=' + encodeURIComponent(shop), { credentials: 'same-origin', cache: 'no-store' })
                        .then(function(r) { return r.ok ? r.json() : null; })
                        .catch(function() { return null; });
                    }
                    return null;
                  })
                  .then(function() {
                    if (msgEl) msgEl.textContent = 'Saved. Applies on next page view.';
                  })
                  .catch(function(err) {
                    if (msgEl) {
                      msgEl.textContent = 'Save failed: ' + (err && err.message ? String(err.message).slice(0, 140) : 'error');
                    }
                  })
                  .finally(function() {
                    toggle.disabled = false;
                    // If the modal is open, refresh diagnostics so the UI reflects the saved setting,
                    // but preserve the current tab/scroll to avoid disrupting viewing.
                    try {
                      if (typeof isConfigModalOpen === 'function' && isConfigModalOpen()) {
                        refreshConfigStatus({ force: true, preserveView: true });
                      }
                    } catch (_) {}
                  });
              };
            }
          } catch (_) {}
          if (typeof evidenceToday !== 'undefined' && typeof evidenceToday.lastOccurredAt === 'number') {
            setLastSaleAt(evidenceToday.lastOccurredAt);
          }
          return c;
        })
        .catch(() => {
          const configStatusEl = document.getElementById('config-status');
          if (configStatusEl) {
            configStatusEl.innerHTML =
              '<div class="dm-error">' +
                '<span class="dm-pill dm-pill-bad">Error</span>' +
                '<span>Could not load diagnostics.</span>' +
              '</div>';
          }
          try {
            const compareIsOpenNow = !!(compareModalEl && compareModalEl.classList.contains('open'));
            if (compareIsOpenNow && compareStatusEl) {
              compareStatusEl.innerHTML =
                '<div class="kpi-compare-error">' +
                  '<div class="kpi-compare-error-title">Error</div>' +
                  '<div class="kpi-compare-error-body">Could not load comparison.</div>' +
                '</div>';
              if (compareUpdatedEl) compareUpdatedEl.textContent = 'Update failed';
            }
          } catch (_) {}
        })
        .finally(function() {
          if (refreshBtn) refreshBtn.classList.remove('spinning');
          if (compareRefreshBtn) compareRefreshBtn.classList.remove('spinning');
          if (configStatusRefreshInFlight === p) configStatusRefreshInFlight = null;
        });
      configStatusRefreshInFlight = p;
      return p;
    }

    // Best-effort: prime Diagnostics data in the background (modal is closed at load).
    try { refreshConfigStatus(); } catch (_) {}

    updateLastSaleAgo();
    _intervals.push(setInterval(updateLastSaleAgo, 10000));

    (function initConfigModal() {
      const modal = document.getElementById('config-modal');
      const openBtn = document.getElementById('config-open-btn');
      const refreshBtn = document.getElementById('config-refresh-btn');
      const reconcileBtn = document.getElementById('config-reconcile-btn');
      const closeBtn = document.getElementById('config-close-btn');
      if (!modal) return;
      function open() {
        try { refreshConfigStatus({ force: true, preserveView: false }); } catch (_) {}
        try { fetchTrafficData({ force: true }); } catch (_) {}
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
      }
      function close() { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
      if (openBtn) openBtn.addEventListener('click', open);
      if (refreshBtn) refreshBtn.addEventListener('click', function() { try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {} });
      if (reconcileBtn) reconcileBtn.addEventListener('click', function() { try { reconcileSalesTruth({}); } catch (_) {} });
      if (closeBtn) closeBtn.addEventListener('click', close);
      modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
      document.addEventListener('keydown', function(e) { if (e.key === 'Escape') close(); });
    })();

    (function initKpiCompareModal() {
      const modal = document.getElementById('kpi-compare-modal');
      const refreshBtn = document.getElementById('kpi-compare-refresh-btn');
      const closeBtn = document.getElementById('kpi-compare-close-btn');
      const kickerEl = document.getElementById('kpi-compare-kicker');
      if (!modal) return;

      function kickerForKey(key) {
        const k = key ? String(key).trim().toLowerCase() : '';
        if (k === 'sessions') return 'Sessions';
        if (k === 'aov') return 'AOV';
        return 'Conversion rate';
      }

      function open(key) {
        activeKpiCompareKey = key ? String(key).trim().toLowerCase() : 'conv';
        if (kickerEl) kickerEl.textContent = kickerForKey(activeKpiCompareKey);
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
      }
      function close() { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }

      document.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        const btn = target && target.closest ? target.closest('.kpi-compare-open-btn[data-kpi-compare]') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const key = (btn.getAttribute('data-kpi-compare') || '').trim().toLowerCase();
        open(key || 'conv');
      });

      if (refreshBtn) refreshBtn.addEventListener('click', function() { try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {} });
      if (closeBtn) closeBtn.addEventListener('click', close);
      modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
      document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        if (!modal.classList.contains('open')) return;
        close();
      });
    })();

    (function initTrafficTypeTree() {
      const body = document.getElementById('traffic-types-body');
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

    (function initTopBar() {
      try { saleMuted = sessionStorage.getItem(SALE_MUTED_KEY) === 'true'; } catch (_) { saleMuted = false; }
      try { saleAudio = new Audio(CASH_REGISTER_MP3_URL); } catch (_) { saleAudio = null; }
      if (saleAudio) {
        try { saleAudio.preload = 'auto'; } catch (_) {}
        try { saleAudio.load(); } catch (_) {}
        // Prime/unlock audio on the first user interaction so sale sounds can play later.
        (function primeOnFirstGesture() {
          function prime() { try { primeSaleAudio(); } catch (_) {} }
          document.addEventListener('pointerdown', prime, { once: true, capture: true });
          document.addEventListener('keydown', prime, { once: true, capture: true });
          document.addEventListener('click', prime, { once: true, capture: true });
        })();
      }
      const muteBtn = document.getElementById('audio-mute-btn');
      const iconOn = muteBtn && muteBtn.querySelector('.sound-icon-on');
      const iconOff = muteBtn && muteBtn.querySelector('.sound-icon-off');
      if (muteBtn) {
        if (iconOn) iconOn.classList.toggle('is-hidden', saleMuted);
        if (iconOff) iconOff.classList.toggle('is-hidden', !saleMuted);
        muteBtn.classList.toggle('muted', saleMuted);
        muteBtn.addEventListener('click', function() {
          saleMuted = !saleMuted;
          try { sessionStorage.setItem(SALE_MUTED_KEY, String(saleMuted)); } catch (_) {}
          if (iconOn) iconOn.classList.toggle('is-hidden', saleMuted);
          if (iconOff) iconOff.classList.toggle('is-hidden', !saleMuted);
          muteBtn.classList.toggle('muted', saleMuted);
          if (!saleMuted) {
            // User gesture: unlock audio so future sale sounds work.
            try { primeSaleAudio(); } catch (_) {}
          }
        });
      }
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
      }
      (function initMobileDateMenu() {
        const btn = document.getElementById('mobile-date-btn');
        const menu = document.getElementById('mobile-date-menu');
        const sel = document.getElementById('global-date-select');
        if (!btn || !menu || !sel) return;

        function close() {
          menu.classList.remove('open');
          btn.setAttribute('aria-expanded', 'false');
        }

        function syncSelection() {
          let cur = String(dateRange || 'today');
          if (cur === 'live' || cur === 'sales' || cur === '1h') cur = 'today';
          if (typeof cur === 'string' && (cur.startsWith('r:') || cur.startsWith('d:'))) cur = 'custom';
          menu.querySelectorAll('.mobile-date-item[data-value]').forEach(function(it) {
            const v = it.getAttribute('data-value');
            it.setAttribute('aria-current', v === cur ? 'true' : 'false');
          });
        }

        function toggle(e) {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          const nextOpen = !menu.classList.contains('open');
          if (nextOpen) syncSelection();
          menu.classList.toggle('open', nextOpen);
          btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        }

        btn.addEventListener('click', toggle);
        menu.querySelectorAll('.mobile-date-item[data-value]').forEach(function(it) {
          it.addEventListener('click', function(e) {
            e.preventDefault();
            const v = String(it.getAttribute('data-value') || '').trim().toLowerCase();
            if (!v) return;
            try {
              const opt = sel.querySelector('option[value="' + v + '"]');
              if (opt && opt.disabled) return;
            } catch (_) {}
            sel.value = v;
            try {
              sel.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (_) {
              // Fallback for older browsers
              const ev = document.createEvent('Event');
              ev.initEvent('change', true, true);
              sel.dispatchEvent(ev);
            }
            close();
          });
        });

        document.addEventListener('click', function(e) {
          if (!menu.classList.contains('open')) return;
          const target = e.target;
          if (menu.contains(target) || btn.contains(target)) return;
          close();
        });
        document.addEventListener('keydown', function(e) {
          if (e.key !== 'Escape') return;
          close();
        });
      })();
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
        const VALID_TABS = ['dashboard', 'spy', 'sales', 'date', 'stats', 'products', 'channels', 'type', 'ads'];
        const TAB_LABELS = { dashboard: 'Dashboard', spy: 'Live', sales: 'Sales', date: 'Date', stats: 'Countries', products: 'Products', channels: 'Channels', type: 'Type', ads: 'Ads' };
        const HASH_TO_TAB = { dashboard: 'dashboard', 'live-view': 'spy', sales: 'sales', date: 'date', countries: 'stats', products: 'products', channels: 'channels', type: 'type', ads: 'ads' };
        const TAB_TO_HASH = { dashboard: 'dashboard', spy: 'live-view', sales: 'sales', date: 'date', stats: 'countries', products: 'products', channels: 'channels', type: 'type', ads: 'ads' };
        const tabDashboard = document.getElementById('nav-tab-dashboard');
        const tabSpy = document.getElementById('nav-tab-spy');
        const tabStats = document.getElementById('nav-tab-stats');
        const tabProducts = document.getElementById('nav-tab-products');
        const tabAds = document.getElementById('nav-tab-ads');
        const tabSales = document.getElementById('nav-tab-sales');
        const tabDate = document.getElementById('nav-tab-date');
        const tabTools = document.getElementById('nav-tab-tools');
        const panelDashboard = document.getElementById('tab-panel-dashboard');
        const panelSpy = document.getElementById('tab-panel-spy');
        const panelStats = document.getElementById('tab-panel-stats');
        const panelProducts = document.getElementById('tab-panel-products');
        const panelAds = document.getElementById('tab-panel-ads');
        const mobileBtn = document.getElementById('mobile-tabs-btn');
        const mobileMenu = document.getElementById('mobile-tabs-menu');
        const mobileCurrent = document.getElementById('mobile-tabs-current');
        const pageTitleEl = document.getElementById('page-title');
        const navLinks = document.querySelectorAll('[data-nav]');

        // Ads tab: lazy-load /ads.js only when Ads is opened.
        let adsLoading = null;
        let adsLoaded = false;
        function ensureAdsLoaded() {
          if (adsLoaded) return Promise.resolve(true);
          if (adsLoading) return adsLoading;
          adsLoading = new Promise(function(resolve) {
            const existing = document.querySelector('script[data-ads-js="1"]');
            if (existing) {
              adsLoaded = true;
              resolve(true);
              return;
            }
            const s = document.createElement('script');
            s.src = '/ads.js';
            s.async = true;
            s.defer = true;
            s.setAttribute('data-ads-js', '1');
            s.onload = function() {
              adsLoaded = true;
              resolve(true);
            };
            s.onerror = function() {
              resolve(false);
            };
            document.head.appendChild(s);
          }).finally(function() {
            adsLoading = null;
          });
          return adsLoading;
        }

        function closeMobileMenu() {
          if (!mobileMenu || !mobileBtn) return;
          mobileMenu.classList.remove('open');
          mobileBtn.setAttribute('aria-expanded', 'false');
        }

        function syncMobileMenu(tab) {
          if (mobileCurrent) {
            mobileCurrent.textContent = TAB_LABELS[tab] || 'Dashboard';
          }
          if (mobileMenu) {
            mobileMenu.querySelectorAll('.mobile-tabs-item[data-tab]').forEach(function(btn) {
              const t = btn.getAttribute('data-tab');
              btn.setAttribute('aria-current', t === tab ? 'true' : 'false');
            });
          }
        }

        function toggleMobileMenu() {
          if (!mobileMenu || !mobileBtn) return;
          const nextOpen = !mobileMenu.classList.contains('open');
          mobileMenu.classList.toggle('open', nextOpen);
          mobileBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        }

        function tabFromHash() {
          var h = location.hash ? location.hash.replace(/^#/, '').toLowerCase() : '';
          return HASH_TO_TAB[h] || null;
        }

        var hashUpdateInProgress = false;
        function setHash(tab) {
          if (PAGE) return;
          var h = TAB_TO_HASH[tab] || 'dashboard';
          if (location.hash === '#' + h) return;
          hashUpdateInProgress = true;
          try { history.replaceState(null, '', '#' + h); } catch (_) {}
          hashUpdateInProgress = false;
        }

        var TAB_TO_NAV = { spy: 'live', stats: 'countries' };
        function updateNavSelection(tab) {
          var navKey = TAB_TO_NAV[tab] || tab;
          navLinks.forEach(function(link) {
            var isActive = link.getAttribute('data-nav') === navKey;
            link.setAttribute('aria-current', isActive ? 'page' : 'false');
            // Apply active to the parent li.nav-item (Tabler pattern), not the link itself
            var parentItem = link.closest('.nav-item');
            if (parentItem) {
              if (isActive) parentItem.classList.add('active'); else parentItem.classList.remove('active');
            }
            link.classList.remove('active');
          });
          if (tabDashboard) tabDashboard.setAttribute('aria-selected', tab === 'dashboard' ? 'true' : 'false');
          if (tabSpy) tabSpy.setAttribute('aria-selected', tab === 'spy' ? 'true' : 'false');
          if (tabStats) tabStats.setAttribute('aria-selected', tab === 'stats' ? 'true' : 'false');
          if (tabProducts) tabProducts.setAttribute('aria-selected', tab === 'products' ? 'true' : 'false');
          if (tabAds) tabAds.setAttribute('aria-selected', tab === 'ads' ? 'true' : 'false');
          if (tabSales) tabSales.setAttribute('aria-selected', tab === 'sales' ? 'true' : 'false');
          if (tabDate) tabDate.setAttribute('aria-selected', tab === 'date' ? 'true' : 'false');
          if (tabTools) tabTools.setAttribute('aria-selected', tab === 'tools' ? 'true' : 'false');
          // Dashboard dropdown — highlight parent li.nav-item when a child page is active
          var isDashboardChild = (tab === 'dashboard' || tab === 'spy' || tab === 'sales' || tab === 'date');
          var dashboardToggle = document.querySelector('.nav-item.dropdown .dropdown-toggle[href="#navbar-dashboard"]');
          var dashboardDropdownItem = dashboardToggle ? dashboardToggle.closest('.nav-item') : null;
          if (dashboardDropdownItem) {
            if (isDashboardChild) dashboardDropdownItem.classList.add('active');
            else dashboardDropdownItem.classList.remove('active');
          }
          // Breakdown dropdown (Countries + Products)
          var isBreakdownChild = (tab === 'stats' || tab === 'products');
          var breakdownToggle = document.querySelector('.nav-item.dropdown .dropdown-toggle[href="#navbar-breakdown"]');
          var breakdownDropdownItem = breakdownToggle ? breakdownToggle.closest('.nav-item') : null;
          if (breakdownDropdownItem) {
            if (isBreakdownChild) breakdownDropdownItem.classList.add('active');
            else breakdownDropdownItem.classList.remove('active');
          }
          // Traffic dropdown
          var isTrafficChild = (tab === 'channels' || tab === 'type');
          var trafficToggle = document.querySelector('.nav-item.dropdown .dropdown-toggle[href="#navbar-traffic"]');
          var trafficDropdownItem = trafficToggle ? trafficToggle.closest('.nav-item') : null;
          if (trafficDropdownItem) {
            if (isTrafficChild) trafficDropdownItem.classList.add('active');
            else trafficDropdownItem.classList.remove('active');
          }
        }

        function runTabWork(tab) {
          var showKpis = (tab !== 'dashboard' && tab !== 'tools');
          var sharedKpiWrap = document.querySelector('.shared-kpi-wrap');
          if (sharedKpiWrap) sharedKpiWrap.style.display = showKpis ? '' : 'none';
          var showDateSel = (tab !== 'tools');
          var globalDateSel = document.getElementById('global-date-select');
          if (globalDateSel) globalDateSel.style.display = showDateSel ? '' : 'none';
          var mobileDateBtn = document.getElementById('mobile-date-btn');
          if (mobileDateBtn) mobileDateBtn.style.display = showDateSel ? '' : 'none';

          syncDateSelectOptions();
          updateNextUpdateUi();

          function ensureKpis() {
            var staleKpis = !lastKpisFetchedAt || (Date.now() - lastKpisFetchedAt) > KPI_REFRESH_MS;
            if (staleKpis) refreshKpis({ force: false });
            else renderLiveKpis(getKpiData());
          }

          if (tab === 'tools') {
            return;
          }
          if (tab === 'dashboard') {
            try { if (typeof refreshDashboard === 'function') refreshDashboard({ force: false }); } catch (_) {}
            refreshKpis({ force: false }).then(function(data) {
              if (data) renderDashboardKpisFromApi(data);
            });
          } else if (tab === 'stats') {
            refreshStats({ force: false });
            ensureKpis();
          } else if (tab === 'products') {
            refreshProducts({ force: false });
            ensureKpis();
          } else if (tab === 'channels' || tab === 'type') {
            refreshTraffic({ force: false });
            ensureKpis();
          } else if (tab === 'ads') {
            ensureKpis();
            ensureAdsLoaded().then(function(ok) {
              if (!ok) return;
              try {
                if (window.__adsInit) window.__adsInit();
                else if (window.__adsRefresh) window.__adsRefresh({ force: false });
              } catch (_) {}
            });
          } else {
            var sessionStaleMs = dateRange === 'live' ? LIVE_REFRESH_MS : (dateRange === 'today' || dateRange === 'sales' || dateRange === '1h' ? RANGE_REFRESH_MS : LIVE_REFRESH_MS);
            var staleSessions = !lastSessionsFetchedAt || (Date.now() - lastSessionsFetchedAt) > sessionStaleMs;
            if (staleSessions) fetchSessions();
            ensureKpis();
          }
        }

        function setTab(tab) {
          var isDashboard = tab === 'dashboard';
          var isSpy = tab === 'spy';
          var isStats = tab === 'stats';
          var isProducts = tab === 'products';
          var isAds = tab === 'ads';
          activeMainTab = tab;
          syncMobileMenu(tab);
          closeMobileMenu();
          setHash(tab);

          if (pageTitleEl && !PAGE) {
            pageTitleEl.textContent = TAB_LABELS[tab] || 'Dashboard';
          }

          updateNavSelection(tab);
          if (panelDashboard) panelDashboard.classList.toggle('active', isDashboard);
          var isSales = tab === 'sales';
          var isDate = tab === 'date';
          if (panelSpy) panelSpy.classList.toggle('active', isSpy || isSales || isDate);
          if (panelStats) panelStats.classList.toggle('active', isStats);
          if (panelProducts) panelProducts.classList.toggle('active', isProducts);
          if (panelAds) panelAds.classList.toggle('active', isAds);

          try { sessionStorage.setItem(TAB_KEY, tab); } catch (_) {}
          runTabWork(tab);
        }

        try { window.setTab = setTab; } catch (_) {}

        if (PAGE) {
          var pageTab = PAGE === 'live' ? 'spy' : PAGE === 'countries' ? 'stats' : PAGE === 'sales' ? 'sales' : PAGE === 'date' ? 'date' : PAGE;
          setTab(pageTab);
          return;
        }

        // Hash-based routing: hash overrides sessionStorage
        var initialTab = 'dashboard';
        var hashTab = tabFromHash();
        if (hashTab && VALID_TABS.indexOf(hashTab) !== -1) {
          initialTab = hashTab;
        } else {
          try {
            var saved = sessionStorage.getItem(TAB_KEY);
            if (saved && VALID_TABS.indexOf(saved) !== -1) initialTab = saved;
          } catch (_) {}
        }
        setTab(initialTab);

        window.addEventListener('hashchange', function() {
          if (hashUpdateInProgress) return;
          var t = tabFromHash();
          if (t && VALID_TABS.indexOf(t) !== -1 && t !== activeMainTab) setTab(t);
        });

        if (tabDashboard) tabDashboard.addEventListener('click', function() { setTab('dashboard'); });
        if (tabSpy) tabSpy.addEventListener('click', function() { setTab('spy'); });
        if (tabStats) tabStats.addEventListener('click', function() { setTab('stats'); });
        if (tabProducts) tabProducts.addEventListener('click', function() { setTab('products'); });
        if (tabAds) tabAds.addEventListener('click', function() { setTab('ads'); });
        if (tabTools) tabTools.addEventListener('click', function() { setTab('tools'); });
        if (mobileBtn && mobileMenu) {
          mobileBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleMobileMenu();
          });
          mobileMenu.querySelectorAll('.mobile-tabs-item[data-tab]').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
              e.preventDefault();
              var t = btn.getAttribute('data-tab') || 'dashboard';
              setTab(t);
            });
          });
          document.addEventListener('click', function(e) {
            if (!mobileMenu.classList.contains('open')) return;
            var target = e.target;
            if (mobileMenu.contains(target) || mobileBtn.contains(target)) return;
            closeMobileMenu();
          });
          document.addEventListener('keydown', function(e) {
            if (e.key !== 'Escape') return;
            closeMobileMenu();
          });
        }
      })();
      (function initRefreshBtn() {
        const btn = document.getElementById('refresh-btn');
        if (btn) {
          btn.addEventListener('click', function() {
            btn.classList.add('refresh-spinning');
            setTimeout(function() { btn.classList.remove('refresh-spinning'); }, 600);
            // If Settings/Diagnostics modal is open, refresh diagnostics too (but keep the user's view).
            try {
              if (typeof isConfigModalOpen === 'function' && isConfigModalOpen()) {
                refreshConfigStatus({ force: true, preserveView: true });
              }
            } catch (_) {}
            if (activeMainTab === 'dashboard') { try { if (typeof refreshDashboard === 'function') refreshDashboard({ force: true }); } catch (_) {} }
            else if (activeMainTab === 'stats') refreshStats({ force: true });
            else if (activeMainTab === 'products') refreshProducts({ force: true });
            else if (activeMainTab === 'channels' || activeMainTab === 'type') refreshTraffic({ force: true });
            else if (activeMainTab === 'ads') { try { if (window.__adsRefresh) window.__adsRefresh({ force: true }); } catch (_) {} }
            else fetchSessions();
          });
        }
      })();
      updateServerTimeDisplay();
      updateNextUpdateUi();
      _intervals.push(setInterval(function() {
        updateServerTimeDisplay();
        updateNextUpdateUi();
      }, 1000));
    })();

    (function setupStatsCardScrollHideHeader() {
      function onScroll(wrapId, cardId) {
        const wrap = document.getElementById(wrapId);
        const card = document.getElementById(cardId);
        if (!wrap || !card) return;
        function update() {
          card.classList.toggle('scrolled', wrap.scrollTop > 0);
        }
        wrap.addEventListener('scroll', update);
        update();
      }
      onScroll('country-table-wrap', 'stats-country');
      onScroll('best-sellers-wrap', 'stats-best-sellers');
      onScroll('best-variants-wrap', 'stats-best-variants');
    })();

    // Load traffic source mapping + custom icons (best-effort).
    try { refreshTrafficSourceMeta({ force: false }); } catch (_) {}

    function onLiveAutoRefreshTick() {
      if (activeMainTab !== 'spy') return;
      if (dateRange !== 'live') return;
      if (document.visibilityState !== 'visible') return;
      fetchSessions();
    }

    function onRangeAutoRefreshTick() {
      if (activeMainTab !== 'spy') return;
      if (dateRange !== 'today' && dateRange !== 'sales' && dateRange !== '1h') return;
      if (document.visibilityState !== 'visible') return;
      if (Date.now() < nextRangeAt) return;
      fetchSessions();
    }

    function onStatsAutoRefreshTick() {
      if (activeMainTab !== 'stats') return;
      if (getStatsRange() !== 'today') return;
      if (document.visibilityState !== 'visible') return;
      refreshStats({ force: false });
    }

    function onKpisAutoRefreshTick() {
      if (document.visibilityState !== 'visible') return;
      if (activeMainTab === 'dashboard' || activeMainTab === 'tools') return;
      refreshKpis({ force: false });
    }

    function onProductsAutoRefreshTick() {
      if (activeMainTab !== 'products') return;
      if (getStatsRange() !== 'today') return;
      if (document.visibilityState !== 'visible') return;
      refreshProducts({ force: false });
    }

    function onTrafficAutoRefreshTick() {
      if (activeMainTab !== 'channels' && activeMainTab !== 'type') return;
      if (getStatsRange() !== 'today') return;
      if (document.visibilityState !== 'visible') return;
      refreshTraffic({ force: false });
    }

    // Live: refresh every 60s. Today/Sales: refresh every 5 min. Products/Traffic: every 5 min (Today only).
    _intervals.push(setInterval(onLiveAutoRefreshTick, LIVE_REFRESH_MS));
    _intervals.push(setInterval(onRangeAutoRefreshTick, 60000)); // check every 60s whether to refresh Today/Sales (5 min interval)
    _intervals.push(setInterval(onKpisAutoRefreshTick, KPI_REFRESH_MS));
    _intervals.push(setInterval(onStatsAutoRefreshTick, STATS_REFRESH_MS));
    _intervals.push(setInterval(onProductsAutoRefreshTick, STATS_REFRESH_MS));
    _intervals.push(setInterval(onTrafficAutoRefreshTick, STATS_REFRESH_MS));
    _intervals.push(setInterval(tickTimeOnSite, 30000));
    // Online count: when not on Live, refresh every 60s so Online always shows real people online
    _intervals.push(setInterval(function() {
      if (activeMainTab !== 'spy' || dateRange === 'live') return;
      fetchOnlineCount();
    }, LIVE_REFRESH_MS));
    // Prune stale sessions from Live list (e.g. tab left open, no SSE update) so they drop off after 10 min or if arrived too long ago
    _intervals.push(setInterval(function() {
      if (activeMainTab !== 'spy' || dateRange !== 'live') return;
      var cutoff = Date.now() - ACTIVE_WINDOW_MS;
      var arrivedCutoff = Date.now() - ARRIVED_WINDOW_MS;
      var before = sessions.length;
      sessions = sessions.filter(function(s) {
        return s.last_seen != null && s.last_seen >= cutoff &&
          s.started_at != null && s.started_at >= arrivedCutoff;
      });
      if (sessions.length !== before) { currentPage = 1; renderTable(); updateKpis(); }
    }, 30000));

    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState !== 'visible') return;
      updateNextUpdateUi();
      if (activeMainTab !== 'dashboard' && activeMainTab !== 'tools') refreshKpis({ force: false });
      if (activeMainTab === 'dashboard') {
        try { if (typeof refreshDashboard === 'function') refreshDashboard({ force: false }); } catch (_) {}
      } else if (activeMainTab === 'stats') {
        const stale = !lastStatsFetchedAt || (Date.now() - lastStatsFetchedAt) > STATS_REFRESH_MS;
        if (stale) refreshStats({ force: false });
      } else if (activeMainTab === 'products') {
        const staleProducts = !lastProductsFetchedAt || (Date.now() - lastProductsFetchedAt) > STATS_REFRESH_MS;
        if (staleProducts) refreshProducts({ force: false });
      } else if (activeMainTab === 'channels' || activeMainTab === 'type') {
        const staleTraffic = !lastTrafficFetchedAt || (Date.now() - lastTrafficFetchedAt) > STATS_REFRESH_MS;
        if (staleTraffic) refreshTraffic({ force: false });
      } else if (activeMainTab === 'ads') {
        try { if (window.__adsRefresh) window.__adsRefresh({ force: false }); } catch (_) {}
      } else {
        const sessionStaleMs = dateRange === 'live' ? LIVE_REFRESH_MS : (dateRange === 'today' || dateRange === 'sales' || dateRange === '1h' ? RANGE_REFRESH_MS : LIVE_REFRESH_MS);
        const stale = !lastSessionsFetchedAt || (Date.now() - lastSessionsFetchedAt) > sessionStaleMs;
        if (stale) fetchSessions();
      }
    });

    function initEventSource() {
      if (_eventSource) { try { _eventSource.close(); } catch (_) {} }
      var es = new EventSource(API + '/api/stream');
      _eventSource = es;
      es.onerror = function() {
        // Browser auto-reconnects on transient errors; if the connection is
        // permanently closed (readyState === CLOSED), retry after a delay.
        if (es.readyState === EventSource.CLOSED) {
          try { es.close(); } catch (_) {}
          setTimeout(function() { if (_eventSource === es) initEventSource(); }, 5000);
        }
      };
      es.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'session_update' && msg.session) {
          const session = msg.session;
          // Keep footer "Last sale" correct even when not on Live tab.
          if (session && session.has_purchased && session.purchased_at != null) {
            setLastSaleAt(session.purchased_at);
          }
          if (activeMainTab !== 'spy' || dateRange !== 'live') return;
          const lastSeen = session.last_seen != null ? Number(session.last_seen) : 0;
          const startedAt = session.started_at != null ? Number(session.started_at) : 0;
          const withinActive = lastSeen >= Date.now() - ACTIVE_WINDOW_MS;
          const withinArrived = startedAt >= Date.now() - ARRIVED_WINDOW_MS;
          const idx = sessions.findIndex(s => s.session_id === session.session_id);
          let becamePurchased = false;
          let filledOrderTotal = false;
          let needRender = false;
          if (idx >= 0) {
            if (!withinActive || !withinArrived) {
              sessions.splice(idx, 1);
              needRender = true;
            } else {
              const wasPurchased = !!sessions[idx].has_purchased;
              const wasOrderTotal = sessions[idx].order_total != null;
              sessions[idx] = { ...sessions[idx], ...session };
              const nowPurchased = !!sessions[idx].has_purchased;
              const nowOrderTotal = sessions[idx].order_total != null;
              becamePurchased = (!wasPurchased && nowPurchased);
              filledOrderTotal = (nowPurchased && !wasOrderTotal && nowOrderTotal);
              sessions.sort(function(a, b) { return (b.last_seen || 0) - (a.last_seen || 0); });
              if (becamePurchased || filledOrderTotal) needRender = true;
              // Avoid a second "cha-ching" when order_total arrives after has_purchased.
              // If the toast is currently showing for this session, just patch the amount.
              if (filledOrderTotal) {
                try {
                  const sid = session && session.session_id != null ? String(session.session_id) : '';
                  if (sid && saleToastActive && saleToastSessionId && String(saleToastSessionId) === sid) {
                    const cc = session && session.country_code ? String(session.country_code).toUpperCase().slice(0, 2) : 'XX';
                    const productTitle = (session && session.last_product_handle) ? titleCaseFromHandle(String(session.last_product_handle)) : '';
                    const curTitle = document.getElementById('sale-toast-product') ? String(document.getElementById('sale-toast-product').textContent || '') : '';
                    let amountGbp = null;
                    if (session && session.order_total != null) {
                      const n = typeof session.order_total === 'number' ? session.order_total : parseFloat(String(session.order_total));
                      if (Number.isFinite(n)) amountGbp = n;
                    }
                    if (amountGbp != null && Number.isFinite(amountGbp)) {
                      setSaleToastContent({ countryCode: cc || 'XX', productTitle: (productTitle || curTitle || '—'), amountGbp });
                    }
                  }
                } catch (_) {}
              }
            }
          } else if (withinActive && withinArrived) {
            sessions.unshift(session);
            sessions.sort(function(a, b) { return (b.last_seen || 0) - (a.last_seen || 0); });
            // Don't play sound when adding a session that's already purchased (e.g. re-add after prune, or heartbeat from old sale)
            becamePurchased = false;
            needRender = true;
          }
          if (needRender) {
            if (becamePurchased) {
              currentPage = 1;
              triggerSaleToast({ origin: 'sse', session: session, playSound: true });
              // Update footer immediately when a sale happens.
              setLastSaleAt(session.purchased_at || session.last_seen || Date.now());
              // Keep the converted-count baseline in sync so KPI/stats refreshes don't double-trigger audio.
              try {
                const day = ymdNowInTz();
                if (convertedCountDayYmd == null) convertedCountDayYmd = day;
                if (day && convertedCountDayYmd !== day) {
                  convertedCountDayYmd = day;
                  hasSeenConvertedCountToday = false;
                  lastConvertedCountToday = 0;
                }
                if (hasSeenConvertedCountToday) lastConvertedCountToday = (Number(lastConvertedCountToday) || 0) + 1;
              } catch (_) {}
              // Avoid background refreshes while the Diagnostics modal is open (don't disrupt reading).
              try {
                if (!(typeof isConfigModalOpen === 'function' && isConfigModalOpen())) {
                  refreshConfigStatus();
                }
              } catch (_) {}
              // Pull updated KPIs so Sales/Orders can animate immediately.
              try { refreshKpis({ force: true }); } catch (_) {}
            }
            renderTable();
            updateKpis();
          }
        }
      } catch (_) {}
    };
    }
    initEventSource();

    // ── Cleanup on page unload ──
    window.addEventListener('beforeunload', function() {
      _intervals.forEach(function(id) { clearInterval(id); });
      _intervals.length = 0;
      if (_eventSource) { try { _eventSource.close(); } catch (_) {} _eventSource = null; }
      Object.keys(_fetchAbortControllers).forEach(function(k) {
        try { _fetchAbortControllers[k].abort(); } catch (_) {}
      });
    });

    // ── Dashboard tab logic ──────────────────────────────────────────────
    (function initDashboard() {
      var dashCache = null;
      var dashLoading = false;
      var dashLastDays = 30;
      var dashCharts = {};
      var _primaryRgbDash = getComputedStyle(document.documentElement).getPropertyValue('--tblr-primary-rgb').trim() || '32,107,196';
      var DASH_ACCENT = 'rgb(' + _primaryRgbDash + ')';
      var DASH_ACCENT_LIGHT = 'rgba(' + _primaryRgbDash + ',0.12)';
      var DASH_ORANGE = '#f59e0b';
      var DASH_ORANGE_LIGHT = 'rgba(245,158,11,0.10)';
      var DASH_BLUE = '#3b82f6';
      var DASH_BLUE_LIGHT = 'rgba(59,130,246,0.10)';
      var DASH_PURPLE = '#8b5cf6';
      var DASH_PURPLE_LIGHT = 'rgba(139,92,246,0.10)';

      function fmtGbp(n) {
        var v = (typeof n === 'number') ? n : Number(n);
        if (!isFinite(v)) return '\u2014';
        return formatRevenue(v) || '\u2014';
      }
      function fmtNum(n) { return n != null ? n.toLocaleString() : '\u2014'; }
      function fmtPct(n) { return n != null ? n.toFixed(1) + '%' : '\u2014'; }
      function shortDate(ymd) {
        var parts = ymd.split('-');
        var d = parseInt(parts[2], 10);
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var m = months[parseInt(parts[1], 10) - 1] || '';
        return d + ' ' + m;
      }

      function waitForApexCharts(cb, retries) {
        if (typeof ApexCharts !== 'undefined') { cb(); return; }
        if (!retries) retries = 0;
        if (retries >= 15) { console.error('[dashboard] ApexCharts failed to load after retries'); return; }
        setTimeout(function() { waitForApexCharts(cb, retries + 1); }, 200);
      }

      var dashChartConfigs = {};

      function makeChart(chartId, labels, datasets, opts) {
        if (typeof ApexCharts === 'undefined') {
          console.warn('[dashboard] ApexCharts not loaded yet, will retry for:', chartId);
          waitForApexCharts(function() { makeChart(chartId, labels, datasets, opts); });
          return null;
        }
        var el = document.getElementById(chartId);
        if (!el) { console.warn('[dashboard] chart element not found:', chartId); return null; }
        if (dashCharts[chartId]) { try { dashCharts[chartId].destroy(); } catch (_) {} }
        el.innerHTML = '';

        dashChartConfigs[chartId] = { labels: labels, datasets: datasets, opts: opts };

        var chartType = (opts && opts.chartType) || 'area';

        try {
          var apexSeries = datasets.map(function(ds) { return { name: ds.label, data: ds.data || [] }; });
          var colors = datasets.map(function(ds) { return ds.borderColor || DASH_ACCENT; });
          var yFmt = (opts && opts.pct) ? function(v) { return v != null ? Number(v).toFixed(1) + '%' : '\u2014'; }
            : (opts && opts.currency) ? function(v) { return v != null ? (formatRevenue(Number(v)) || '\u2014') : '\u2014'; }
            : function(v) { return v != null ? Number(v).toLocaleString() : '\u2014'; };

          var fillConfig = chartType === 'line' ? { type: 'solid', opacity: 0 }
            : chartType === 'bar' ? { type: 'solid', opacity: 1 }
            : { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.15, opacityTo: 0.02, stops: [0, 100] } };

          var apexOpts = {
            chart: {
              type: chartType,
              height: 200,
              fontFamily: 'Inter, sans-serif',
              toolbar: { show: false },
              animations: { enabled: true, easing: 'easeinout', speed: 300 },
              zoom: { enabled: false }
            },
            series: apexSeries,
            colors: colors,
            stroke: { width: chartType === 'bar' ? 0 : 2, curve: 'smooth' },
            fill: fillConfig,
            plotOptions: chartType === 'bar' ? { bar: { columnWidth: '60%', borderRadius: 3 } } : {},
            xaxis: {
              categories: labels || [],
              labels: { style: { fontSize: '10px', cssClass: 'apexcharts-xaxis-label' }, rotate: 0, hideOverlappingLabels: true },
              axisBorder: { show: false },
              axisTicks: { show: false }
            },
            yaxis: {
              labels: { style: { fontSize: '11px', cssClass: 'apexcharts-yaxis-label' }, formatter: yFmt },
              min: 0
            },
            grid: { borderColor: '#f0f0f0', strokeDashArray: 3 },
            tooltip: { y: { formatter: yFmt } },
            legend: { show: apexSeries.length > 1, position: 'top', fontSize: '11px' },
            dataLabels: { enabled: false },
            markers: { size: chartType === 'line' ? 3 : 0, hover: { size: 5 } },
            noData: { text: 'No data available', style: { fontSize: '13px', color: '#626976' } }
          };

          var chart = new ApexCharts(el, apexOpts);
          chart.render();
          dashCharts[chartId] = chart;
          initChartTypeSwitcher(chartId);
          return chart;
        } catch (err) {
          console.error('[dashboard] chart render error:', chartId, err);
          return null;
        }
      }

      function switchChartType(chartId, newType) {
        var cfg = dashChartConfigs[chartId];
        if (!cfg) return;
        var o = Object.assign({}, cfg.opts || {}, { chartType: newType });
        makeChart(chartId, cfg.labels, cfg.datasets, o);
      }

      function initChartTypeSwitcher(chartId) {
        var el = document.getElementById(chartId);
        if (!el) return;
        var card = el.closest('.card');
        if (!card) return;
        var header = card.querySelector('.card-header');
        if (!header) return;
        if (header.querySelector('.chart-type-switcher')) return;

        var wrap = document.createElement('div');
        wrap.className = 'chart-type-switcher ms-auto d-flex gap-1';
        var types = [
          { type: 'area', icon: 'ti-chart-area-line', label: 'Area' },
          { type: 'line', icon: 'ti-chart-line', label: 'Line' },
          { type: 'bar', icon: 'ti-chart-bar', label: 'Bar' }
        ];
        types.forEach(function(t) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-icon btn-ghost-secondary btn-sm' + (t.type === 'area' ? ' active' : '');
          btn.setAttribute('aria-label', t.label);
          btn.setAttribute('data-chart-type', t.type);
          btn.innerHTML = '<i class="ti ' + t.icon + '"></i>';
          btn.addEventListener('click', function() {
            wrap.querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            switchChartType(chartId, t.type);
          });
          wrap.appendChild(btn);
        });
        header.appendChild(wrap);
      }

      function renderDashboard(data) {
        if (!data) return;
        var allSeries = data.series || [];
        var displayDays = dashLastDays || Math.ceil(allSeries.length / 2) || 1;
        // Current period for secondary stats; charts use at least 7 data points
        var series = allSeries.slice(-displayDays);
        var chartDays = Math.max(displayDays, 7);
        var chartSeries = allSeries.slice(-Math.min(chartDays, allSeries.length));

        var el = function(id) { return document.getElementById(id); };
        // Recompute summary from current period only
        function sumField(arr, field) { var t = 0; for (var i = 0; i < arr.length; i++) t += (arr[i][field] || 0); return t; }
        function avgField(arr, field) { if (!arr.length) return 0; return sumField(arr, field) / arr.length; }

        var s = data.summary || {};
        var curRevenue = sumField(series, 'revenue');
        var curOrders = sumField(series, 'orders');
        var curSessions = sumField(series, 'sessions');
        var curConvRate = avgField(series, 'convRate');
        var curAov = avgField(series, 'aov');
        var curBounceRate = avgField(series, 'bounceRate');
        var curAdSpend = sumField(series, 'adSpend');
        // These are computed server-side as summary totals (not per-day series points).
        var curReturning = (s && typeof s.returningCustomerOrders === 'number') ? s.returningCustomerOrders : sumField(series, 'returningCustomerOrders');
        var curNewCustomers = (s && typeof s.newCustomerOrders === 'number') ? s.newCustomerOrders : sumField(series, 'newCustomerOrders');
        var curDesktop = (s && typeof s.desktopSessions === 'number') ? s.desktopSessions : sumField(series, 'desktopSessions');
        var curMobile = (s && typeof s.mobileSessions === 'number') ? s.mobileSessions : sumField(series, 'mobileSessions');

        // Main KPI values + change badges are set by renderDashboardKpisFromApi() using /api/kpis
        if (el('dash-kpi-adspend')) el('dash-kpi-adspend').textContent = curAdSpend > 0 ? fmtGbp(curAdSpend) : '\u2014';

        // Secondary stats
        var numDays = series.length || 1;

        // Orders: Today + Avg/Day
        if (el('dash-orders-today')) {
          var todayOrders = series.length > 0 ? (series[series.length - 1].orders || 0) : 0;
          el('dash-orders-today').textContent = fmtNum(todayOrders);
        }
        if (el('dash-orders-avg')) {
          var avgOrders = numDays > 0 ? Math.round(curOrders / numDays * 10) / 10 : 0;
          el('dash-orders-avg').textContent = avgOrders % 1 === 0 ? fmtNum(avgOrders) : avgOrders.toFixed(1);
        }

        // Conversion Rate: progress bar + target diff
        if (el('dash-conv-progress')) {
          var convPct = Math.min(curConvRate / 2.5 * 100, 100);
          el('dash-conv-progress').style.width = convPct.toFixed(1) + '%';
        }
        if (el('dash-conv-target-diff')) {
          var diff = curConvRate - 2.5;
          el('dash-conv-target-diff').textContent = (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%';
          el('dash-conv-target-diff').className = diff >= 0 ? 'text-success' : 'text-danger';
        }

        // AOV: Highest / Lowest
        if (el('dash-aov-high')) el('dash-aov-high').textContent = s.aovHigh != null ? fmtGbp(s.aovHigh) : '\u2014';
        if (el('dash-aov-low')) el('dash-aov-low').textContent = s.aovLow != null ? fmtGbp(s.aovLow) : '\u2014';

        // Sessions: Desktop / Mobile
        if (el('dash-sessions-desktop')) el('dash-sessions-desktop').textContent = fmtNum(curDesktop);
        if (el('dash-sessions-mobile')) el('dash-sessions-mobile').textContent = fmtNum(curMobile);

        // Bounce Rate: progress bar
        if (el('dash-bounce-progress')) {
          el('dash-bounce-progress').style.width = Math.min(curBounceRate, 100).toFixed(1) + '%';
        }

        // Returning Customers: New / Return split
        if (el('dash-customers-new')) el('dash-customers-new').textContent = fmtNum(curNewCustomers);
        if (el('dash-customers-return')) el('dash-customers-return').textContent = fmtNum(curReturning);

        // ROAS badge + progress
        var curRoas = curAdSpend > 0 ? curRevenue / curAdSpend : null;
        if (el('dash-roas-badge')) el('dash-roas-badge').textContent = curRoas != null ? curRoas.toFixed(2) + 'x' : '\u2014';
        if (el('dash-roas-progress')) {
          var roasPct = curRoas != null ? Math.min(curRoas / 5 * 100, 100) : 0;
          el('dash-roas-progress').style.width = roasPct.toFixed(1) + '%';
        }

        // Sparklines in KPI cards (current period only)
        function renderSparkline(elId, dataArr, color) {
          var sparkEl = el(elId);
          if (!sparkEl || dataArr.length < 2 || typeof ApexCharts === 'undefined') return;
          sparkEl.innerHTML = '';
          var chart = new ApexCharts(sparkEl, {
            chart: { type: 'area', height: 40, sparkline: { enabled: true }, animations: { enabled: false } },
            series: [{ data: dataArr }],
            stroke: { width: 2, curve: 'smooth' },
            fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0.05 } },
            colors: [color],
            tooltip: { enabled: false }
          });
          chart.render();
        }
        renderSparkline('dash-revenue-sparkline', chartSeries.map(function(d) { return d.revenue; }), DASH_ACCENT);
        renderSparkline('dash-sessions-sparkline', chartSeries.map(function(d) { return d.sessions; }), DASH_ORANGE);
        renderSparkline('dash-orders-sparkline', chartSeries.map(function(d) { return d.orders; }), DASH_BLUE);
        renderSparkline('dash-returning-sparkline', chartSeries.map(function(d) { return d.returningCustomerOrders || 0; }), DASH_PURPLE);

        var labels = chartSeries.map(function(d) { return shortDate(d.date); });

        makeChart('dash-chart-revenue', labels, [{
          label: 'Revenue',
          data: chartSeries.map(function(d) { return d.revenue; }),
          borderColor: DASH_ACCENT,
          backgroundColor: DASH_ACCENT_LIGHT,
          fill: true,
          borderWidth: 2
        }], { currency: true });

        makeChart('dash-chart-orders', labels, [{
          label: 'Orders',
          data: chartSeries.map(function(d) { return d.orders; }),
          borderColor: DASH_BLUE,
          backgroundColor: DASH_BLUE_LIGHT,
          fill: true,
          borderWidth: 2
        }]);

        var hasShopifyConv = chartSeries.some(function(d) { return d.shopifyConvRate != null; });
        var convDatasets = [{
          label: 'Kexo Conv Rate',
          data: chartSeries.map(function(d) { return d.convRate; }),
          borderColor: DASH_PURPLE,
          backgroundColor: DASH_PURPLE_LIGHT,
          fill: true,
          borderWidth: 2
        }];
        if (hasShopifyConv) {
          convDatasets.push({
            label: 'Shopify Conv Rate',
            data: chartSeries.map(function(d) { return d.shopifyConvRate; }),
            borderColor: '#5c6ac4',
            backgroundColor: 'rgba(92,106,196,0.10)',
            fill: false,
            borderWidth: 2,
            borderDash: [5, 3]
          });
        }
        makeChart('dash-chart-conv', labels, convDatasets, { pct: true });

        makeChart('dash-chart-sessions', labels, [{
          label: 'Sessions',
          data: chartSeries.map(function(d) { return d.sessions; }),
          borderColor: DASH_ORANGE,
          backgroundColor: DASH_ORANGE_LIGHT,
          fill: true,
          borderWidth: 2
        }]);

        var hasAdSpend = chartSeries.some(function(d) { return d.adSpend > 0; });
        var adRow = el('dash-adspend-row');
        if (adRow) adRow.style.display = hasAdSpend ? '' : 'none';
        if (hasAdSpend) {
          makeChart('dash-chart-adspend', labels, [{
            label: 'Revenue',
            data: chartSeries.map(function(d) { return d.revenue; }),
            borderColor: DASH_ACCENT,
            backgroundColor: 'transparent',
            borderWidth: 2
          }, {
            label: 'Ad Spend',
            data: chartSeries.map(function(d) { return d.adSpend; }),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.08)',
            fill: true,
            borderWidth: 2
          }], { currency: true });
        }

        var prodTbody = el('dash-top-products') ? el('dash-top-products').querySelector('tbody') : null;
        if (prodTbody) {
          var products = data.topProducts || [];
          if (!products.length) {
            prodTbody.innerHTML = '<tr><td colspan="3" class="dash-empty">No data</td></tr>';
          } else {
            prodTbody.innerHTML = products.map(function(p) {
              var thumbHtml = '<span class="thumb-wrap">' +
                (p.thumb_url ? '<img class="landing-thumb" src="' + escapeHtml(hotImg(p.thumb_url)) + '" loading="lazy" alt="" onerror="this.remove()">' : '') +
              '</span>';
              return '<tr><td><span class="product-cell">' + thumbHtml + ' ' + escapeHtml(p.title) + '</span></td><td class="text-end">' + fmtGbp(p.revenue) + '</td><td class="text-end">' + p.orders + '</td></tr>';
            }).join('');
          }
        }

        var countryTbody = el('dash-top-countries') ? el('dash-top-countries').querySelector('tbody') : null;
        if (countryTbody) {
          var countries = data.topCountries || [];
          if (!countries.length) {
            countryTbody.innerHTML = '<tr><td colspan="3" class="dash-empty">No data</td></tr>';
          } else {
            countryTbody.innerHTML = countries.map(function(c) {
              var cc = (c.country || 'XX').toUpperCase();
              var name = (typeof countryLabelFull === 'function') ? countryLabelFull(cc) : cc;
              return '<tr><td><span style="display:inline-flex;align-items:center;gap:0.5rem">' + flagImg(cc, name) + ' ' + escapeHtml(name) + '</span></td><td class="text-end">' + fmtGbp(c.revenue) + '</td><td class="text-end">' + c.orders + '</td></tr>';
            }).join('');
          }
        }
      }

      function fetchDashboardData(days, force) {
        if (dashLoading && !force) return;
        try {
          var n = parseInt(days, 10);
          if (!Number.isFinite(n) || n <= 0) n = 7;
          var todayYmd = ymdNowInTz();
          if (todayYmd && todayYmd >= MIN_YMD) {
            var a = new Date(MIN_YMD + 'T00:00:00.000Z');
            var b = new Date(todayYmd + 'T00:00:00.000Z');
            var maxDays = Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
            if (Number.isFinite(maxDays) && maxDays > 0) n = Math.min(n, maxDays);
          } else {
            n = 1;
          }
          days = n;
        } catch (_) {}
        dashLoading = true;
        showPageProgress();
        var fetchDays = Math.max(days * 2, 14); // Enough data for charts + comparison
        var url = API + '/api/dashboard-series?days=' + fetchDays + (force ? '&_=' + Date.now() : '');
        fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
          .then(function(r) { return (r && r.ok) ? r.json() : null; })
          .then(function(data) {
            dashLoading = false;
            if (data) {
              dashCache = data;
              dashLastDays = days;
              renderDashboard(data);
            }
          })
          .catch(function(err) {
            dashLoading = false;
            console.error('[dashboard] fetch error:', err);
          })
          .finally(function() {
            hidePageProgress();
          });
      }

      function dashDaysFromDateRange() {
        var r = (typeof dateRange === 'string') ? dateRange.trim().toLowerCase() : 'today';
        if (r === 'today' || r === 'live' || r === 'sales' || r === '1h') return 1;
        if (r === 'yesterday') return 1;
        if (r === '7days') return 7;
        if (r === '14days') return 14;
        if (r === '30days') return 30;
        // Custom range: compute days between start and end
        if (r.startsWith('r:')) {
          try {
            var parts = r.slice(2).split(':');
            var s = new Date(parts[0] + 'T00:00:00Z');
            var e = new Date(parts[1] + 'T00:00:00Z');
            var diff = Math.round((e - s) / 86400000) + 1;
            if (Number.isFinite(diff) && diff > 0) return Math.min(diff, 90);
          } catch (_) {}
        }
        if (r.startsWith('d:')) return 1;
        return 7;
      }

      window.refreshDashboard = function(opts) {
        var force = opts && opts.force;
        var days = dashDaysFromDateRange();
        if (!force && dashCache && dashLastDays === days) {
          renderDashboard(dashCache);
          return;
        }
        fetchDashboardData(days, force);
      };

      // Initial fetch: refreshDashboard is defined after setTab('dashboard') runs,
      // so the initial setTab call can't trigger it. Kick it off now if dashboard is active.
      var dashPanel = document.getElementById('tab-panel-dashboard');
      if (dashPanel && (dashPanel.classList.contains('active') || PAGE === 'dashboard')) {
        fetchDashboardData(dashDaysFromDateRange(), false);
      }
    })();

    // ── User avatar: fetch /api/me and populate ────────────────────────
    (function initUserAvatar() {
      try {
        fetch('/api/me').then(function(r) { return r.json(); }).then(function(d) {
          if (!d || !d.email) return;
          var avatarEl = document.getElementById('user-avatar');
          var emailEl = document.getElementById('user-email');
          if (avatarEl && d.initial) avatarEl.textContent = d.initial;
          if (emailEl) emailEl.textContent = d.email;
        }).catch(function() {});
      } catch (_) {}
    })();

    // ── Footer action buttons ──────────────────────────────────────────
    (function initFooterActions() {
      function proxyClick(footerSel, headerId) {
        document.querySelectorAll(footerSel).forEach(function(btn) {
          btn.addEventListener('click', function() {
            var h = document.getElementById(headerId);
            if (h) h.click();
          });
        });
      }
      proxyClick('.footer-refresh-btn', 'refresh-btn');
      proxyClick('.footer-audio-btn', 'audio-mute-btn');
      proxyClick('.footer-theme-btn', 'theme-settings-btn');
      proxyClick('.footer-diagnostics-btn', 'config-open-btn');
    })();

})();
