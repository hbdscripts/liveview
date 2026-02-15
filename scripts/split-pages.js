const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'server', 'public', 'live-visitors.html');
const outDir = path.join(__dirname, '..', 'server', 'public');
const src = fs.readFileSync(srcPath, 'utf8');

function extract(start, end) {
  const s = src.indexOf(start);
  if (s < 0) throw new Error(`Missing start: ${start}`);
  const e = src.indexOf(end, s);
  if (e < 0) throw new Error(`Missing end: ${end}`);
  return src.slice(s, e).trim();
}

function extractToEnd(start, end) {
  const s = src.indexOf(start);
  if (s < 0) throw new Error(`Missing start: ${start}`);
  const e = src.indexOf(end, s);
  if (e < 0) throw new Error(`Missing end: ${end}`);
  return src.slice(s, e).trim();
}

const panels = {
  dashboard: extract('<div id="tab-panel-dashboard"', '<div id="tab-panel-spy"'),
  live: extract('<div id="tab-panel-spy"', '<div id="tab-panel-stats"'),
  countries: extract('<div id="tab-panel-stats"', '<div id="tab-panel-breakdown"'),
  overview: extract('<div id="tab-panel-breakdown"', '<div id="tab-panel-products"'),
  products: extract('<div id="tab-panel-products"', '<div id="tab-panel-traffic"'),
  traffic: extract('<div id="tab-panel-traffic"', '<div id="tab-panel-ads"'),
  ads: extract('<div id="tab-panel-ads"', '<div id="side-panel"'),
};

const sidePanel = extract('<div id="side-panel"', '</main>');
const footer = extractToEnd('<footer class="dashboard-footer"', '</footer>');
const modals = extract('<div class="config-modal" id="config-modal"', '<script>');

const nav = () => `
<header class="navbar navbar-expand-md navbar-light d-print-none">
  <div class="container-xl">
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbar-menu">
      <span class="navbar-toggler-icon"></span>
    </button>
    <a class="navbar-brand" href="/dashboard/overview">
      <img src="/assets/logos/new/kexo.webp" alt="Kexo" />
    </a>
    <div class="collapse navbar-collapse" id="navbar-menu">
      <ul class="navbar-nav">
        <li class="nav-item"><a class="nav-link" id="nav-tab-dashboard" data-nav="dashboard" href="/dashboard/overview">Overview</a></li>
        <li class="nav-item"><a class="nav-link" id="nav-tab-spy" data-nav="live" href="/dashboard/live">Live View</a></li>
        <li class="nav-item"><a class="nav-link" id="nav-tab-sales" data-nav="sales" href="/dashboard/sales">Recent Sales</a></li>
        <li class="nav-item"><a class="nav-link" id="nav-tab-date" data-nav="date" href="/dashboard/table">Table View</a></li>
        <li class="nav-item"><a class="nav-link" id="nav-tab-stats" data-nav="countries" href="/insights/countries">Countries</a></li>
        <li class="nav-item"><a class="nav-link" id="nav-tab-products" data-nav="products" href="/insights/products">Products</a></li>
        <li class="nav-item"><a class="nav-link" id="nav-tab-channels" data-nav="channels" href="/traffic/channels">Channels</a></li>
        <li class="nav-item"><a class="nav-link" id="nav-tab-type" data-nav="type" href="/traffic/device">Device &amp; Platform</a></li>
        <li class="nav-item"><a class="nav-link" id="nav-tab-ads" data-nav="ads" href="/tools/ads">Google Ads</a></li>
        <li class="nav-item"><a class="nav-link" id="nav-tab-tools" data-nav="tools" href="/tools/compare-conversion-rate">Conversion Rate Compare</a></li>
      </ul>
      <div class="ms-auto d-flex align-items-center gap-2">
        <select id="global-date-select" class="form-select form-select-sm" aria-label="Date range">
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="custom" id="date-opt-custom">Custom</option>
        </select>
        <button type="button" class="btn btn-icon btn-sm" id="refresh-btn" aria-label="Refresh">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
        <button type="button" class="btn btn-icon btn-sm" id="config-open-btn" aria-label="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    </div>
  </div>
</header>`;

const sharedKpi = `
<div class="shared-kpi-wrap" aria-label="KPIs for selected date range">
  <div class="kpi-mobile-pager">
  <div class="live-kpi-grid" id="live-kpi-grid">
    <div class="live-kpi-cell" id="live-kpi-sales-cell">
      <div class="live-kpi-label" id="live-kpi-sales-label">Sales</div>
      <div class="live-kpi-value" id="live-kpi-sales">—</div>
      <div class="live-kpi-sub is-hidden" id="live-kpi-sales-sub"></div>
    </div>
    <div class="live-kpi-cell" id="live-kpi-conv-cell">
      <div class="live-kpi-label">Conv rate</div>
      <div class="live-kpi-value" id="live-kpi-conv">—</div>
      <div class="live-kpi-sub is-hidden" id="live-kpi-conv-sub"></div>
    </div>
    <div class="live-kpi-cell"><div class="live-kpi-label">Sessions</div><div class="live-kpi-value" id="live-kpi-sessions">—</div><div class="live-kpi-sub is-hidden" id="live-kpi-sessions-sub"></div></div>
    <div class="live-kpi-cell"><div class="live-kpi-label">Returning</div><div class="live-kpi-value" id="live-kpi-returning">—</div><div class="live-kpi-sub is-hidden" id="live-kpi-returning-sub"></div></div>
    <div class="live-kpi-cell"><div class="live-kpi-label">AOV</div><div class="live-kpi-value" id="live-kpi-aov">—</div><div class="live-kpi-sub is-hidden" id="live-kpi-aov-sub"></div></div>
    <div class="live-kpi-cell"><div class="live-kpi-label">Bounce</div><div class="live-kpi-value" id="live-kpi-bounce">—</div><div class="live-kpi-sub is-hidden" id="live-kpi-bounce-sub"></div></div>
  </div>
  <button type="button" class="kpi-mobile-next is-hidden" id="kpi-mobile-next" aria-label="Next KPIs" title="Next KPIs">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
  </button>
  </div>
</div>`;

const pageTemplate = (page, title, content, extra = '') => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <link rel="icon" type="image/webp" href="/assets/logos/new/kexo.webp" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://unpkg.com/@tabler/core@1.0.0-beta22/dist/css/tabler.min.css" />
  <link rel="stylesheet" href="/tabler-theme.css" />
  <link rel="stylesheet" href="/app.css" />
  <link rel="stylesheet" href="/diagnostics-modal.css" />
  <title>Kexo · ${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js" defer></script>
</head>
<body data-page="${page}">
  <div class="page">
    ${nav()}
    <div class="page-wrapper">
      <div class="container-xl">
        <div class="page-header d-flex align-items-center justify-content-between">
          <h2 class="page-title" id="page-title">${title}</h2>
        </div>
        ${sharedKpi}
        <div class="page-body">
          ${content}
        </div>
      </div>
      ${extra}
    </div>
  </div>
  ${footer}
  ${modals}
  <script src="https://unpkg.com/@tabler/core@1.0.0-beta22/dist/js/tabler.min.js" defer></script>
  <script src="/app.js" defer></script>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, 'dashboard.html'), pageTemplate('dashboard', 'Dashboard', panels.dashboard));
fs.writeFileSync(path.join(outDir, 'live.html'), pageTemplate('live', 'Live View', panels.live, sidePanel));
fs.writeFileSync(path.join(outDir, 'countries.html'), pageTemplate('countries', 'Countries', panels.countries));
fs.writeFileSync(path.join(outDir, 'overview.html'), pageTemplate('overview', 'Overview', panels.overview));
fs.writeFileSync(path.join(outDir, 'products.html'), pageTemplate('products', 'Products', panels.products));
fs.writeFileSync(path.join(outDir, 'traffic.html'), pageTemplate('traffic', 'Traffic', panels.traffic));
fs.writeFileSync(path.join(outDir, 'ads.html'), pageTemplate('ads', 'Ads', panels.ads));

console.log('Pages generated.');
