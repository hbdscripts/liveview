(function initInsightsSnapshotPage() {
  'use strict';

  if (window.__kexoInsightsSnapshotInit) return;
  const body = document.body;
  if (!body || String(body.getAttribute('data-page') || '') !== 'snapshot') return;
  window.__kexoInsightsSnapshotInit = true;

  const API = window.API || '';
  const state = {
    authorized: null,
    loading: false,
    requestId: 0,
    charts: Object.create(null),
    data: null,
    preset: 'this_month',
    since: '',
    until: '',
    performanceMetric: 'sessions',
    rulesDraft: null,
    editingRuleId: '',
    profitModalOpen: false,
    profitModalBackdrop: null,
    compactNumbers: true,
    showGraphs: { revenueCost: false, performance: false, customers: false },
  };

  const PRESETS = new Set([
    'this_month',
    'last_month',
    'last_30_days',
    'last_90_days',
    'last_6_months',
    'ytd',
    'custom',
  ]);

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function round1(value) {
    const n = toNumber(value);
    if (n == null) return null;
    return Math.round(n * 10) / 10;
  }

  function round2(value) {
    const n = toNumber(value);
    if (n == null) return null;
    return Math.round(n * 100) / 100;
  }

  function pad2(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '00';
    return String(Math.trunc(n)).padStart(2, '0');
  }

  function parseYmd(ymd) {
    const s = String(ymd || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (month < 1 || month > 12) return null;
    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day < 1 || day > maxDay) return null;
    return { year, month, day };
  }

  function formatYmd(year, month, day) {
    return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
  }

  function ymdToDate(ymd) {
    const p = parseYmd(ymd);
    if (!p) return null;
    return new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
  }

  function ymdAddDays(ymd, days) {
    const d = ymdToDate(ymd);
    if (!d) return ymd;
    d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
    return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  function ymdAddMonths(ymd, months) {
    const p = parseYmd(ymd);
    if (!p) return ymd;
    const mDelta = Number(months);
    if (!Number.isFinite(mDelta)) return ymd;
    const targetMonthIndex = (p.year * 12 + (p.month - 1)) + Math.trunc(mDelta);
    const targetYear = Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12 + 1;
    const maxDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return formatYmd(targetYear, targetMonth, Math.min(p.day, maxDay));
  }

  function ymdMonthStart(ymd) {
    const p = parseYmd(ymd);
    if (!p) return ymd;
    return formatYmd(p.year, p.month, 1);
  }

  function ymdMonthEnd(ymd) {
    const p = parseYmd(ymd);
    if (!p) return ymd;
    const day = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
    return formatYmd(p.year, p.month, day);
  }

  function getTodayYmd() {
    const d = new Date();
    return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  function presetLabel(preset) {
    if (preset === 'this_month') return 'This month';
    if (preset === 'last_month') return 'Last month';
    if (preset === 'last_30_days') return 'Last 30 days';
    if (preset === 'last_90_days') return 'Last 90 days';
    if (preset === 'last_6_months') return 'Last 6 months';
    if (preset === 'ytd') return 'Year to date';
    if (preset === 'custom') return 'Custom range';
    return 'Range';
  }

  function computePresetRange(preset, nowYmd) {
    const today = parseYmd(nowYmd) ? nowYmd : getTodayYmd();
    if (preset === 'this_month') {
      return { since: ymdMonthStart(today), until: today };
    }
    if (preset === 'last_month') {
      const prevMonthSeed = ymdAddMonths(ymdMonthStart(today), -1);
      return { since: ymdMonthStart(prevMonthSeed), until: ymdMonthEnd(prevMonthSeed) };
    }
    if (preset === 'last_30_days') {
      return { since: ymdAddDays(today, -29), until: today };
    }
    if (preset === 'last_90_days') {
      return { since: ymdAddDays(today, -89), until: today };
    }
    if (preset === 'last_6_months') {
      return { since: ymdAddDays(ymdAddMonths(today, -6), 1), until: today };
    }
    if (preset === 'ytd') {
      const p = parseYmd(today);
      return { since: formatYmd(p.year, 1, 1), until: today };
    }
    return { since: today, until: today };
  }

  function clampRange(since, until) {
    const a = parseYmd(since);
    const b = parseYmd(until);
    if (!a || !b) return null;
    let start = formatYmd(a.year, a.month, a.day);
    let end = formatYmd(b.year, b.month, b.day);
    if (start > end) {
      const t = start;
      start = end;
      end = t;
    }
    return { since: start, until: end };
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtInt(value) {
    const n = toNumber(value);
    if (n == null) return '-';
    if (state.compactNumbers) {
      const abs = Math.abs(n);
      if (abs >= 1000) {
        const divisor = abs >= 1000000000 ? 1000000000 : (abs >= 1000000 ? 1000000 : 1000);
        const suffix = divisor === 1000000000 ? 'B' : (divisor === 1000000 ? 'M' : 'K');
        const scaled = abs / divisor;
        const rounded = Math.round(scaled * 10) / 10;
        const text = Number.isInteger(rounded)
          ? String(rounded)
          : String(rounded.toFixed(1)).replace(/\.0$/, '');
        return `${n < 0 ? '-' : ''}${text}${suffix}`;
      }
    }
    return Math.round(n).toLocaleString('en-GB');
  }

  function fmtCurrency(value) {
    const n = toNumber(value);
    if (n == null) return '-';
    if (state.compactNumbers) {
      const abs = Math.abs(n);
      if (abs >= 1000) {
        const divisor = abs >= 1000000000 ? 1000000000 : (abs >= 1000000 ? 1000000 : 1000);
        const suffix = divisor === 1000000000 ? 'B' : (divisor === 1000000 ? 'M' : 'K');
        const scaled = abs / divisor;
        const rounded = Math.round(scaled * 10) / 10;
        const text = Number.isInteger(rounded)
          ? String(rounded)
          : String(rounded.toFixed(1)).replace(/\.0$/, '');
        return `${n < 0 ? '-' : ''}£${text}${suffix}`;
      }
    }
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n);
    } catch (_) {
      const sign = n < 0 ? '-' : '';
      return `${sign}£${Math.abs(n).toFixed(2)}`;
    }
  }

  function fmtPercent(value) {
    const n = toNumber(value);
    if (n == null) return '-';
    return `${round1(n)}%`;
  }

  function fmtRoas(value) {
    const n = toNumber(value);
    if (n == null) return '-';
    return `${round2(n)}x`;
  }

  function fmtDeltaPercent(value) {
    const n = toNumber(value);
    if (n == null) return '-';
    const fixed = Math.abs(round1(n));
    return `${n > 0 ? '+' : (n < 0 ? '-' : '')}${fixed}%`;
  }

  function formatDateLabel(ymd) {
    const d = ymdToDate(ymd);
    if (!d) return String(ymd || '');
    try {
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    } catch (_) {
      return String(ymd || '');
    }
  }

  function formatDateSpan(since, until) {
    const a = formatDateLabel(since);
    const b = formatDateLabel(until);
    if (a === b) return a;
    return `${a} - ${b}`;
  }

  function isTruthyAdmin(me) {
    const data = me && typeof me === 'object' ? me : {};
    if (data.isMaster === true || data.isAdmin === true) return true;
    const role = String(data.role || '').toLowerCase();
    return role === 'master' || role === 'admin';
  }

  function parseQueryState() {
    const params = new URLSearchParams(window.location.search || '');
    const presetRaw = String(params.get('preset') || '').toLowerCase();
    const fromUrlPreset = PRESETS.has(presetRaw) ? presetRaw : '';
    const sinceRaw = String(params.get('since') || '').slice(0, 10);
    const untilRaw = String(params.get('until') || '').slice(0, 10);

    if (fromUrlPreset && fromUrlPreset !== 'custom') {
      const range = computePresetRange(fromUrlPreset, getTodayYmd());
      return { preset: fromUrlPreset, since: range.since, until: range.until };
    }
    if (parseYmd(sinceRaw) && parseYmd(untilRaw)) {
      const clamped = clampRange(sinceRaw, untilRaw);
      return { preset: 'custom', since: clamped.since, until: clamped.until };
    }
    const defaultRange = computePresetRange('this_month', getTodayYmd());
    return { preset: 'this_month', since: defaultRange.since, until: defaultRange.until };
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (state.preset === 'custom') {
      params.set('since', state.since);
      params.set('until', state.until);
    } else {
      params.set('preset', state.preset);
    }
    const next = `${window.location.pathname}${params.toString() ? (`?${params.toString()}`) : ''}`;
    window.history.replaceState({}, '', next);
  }

  function destroyCharts() {
    Object.keys(state.charts).forEach((key) => {
      const chart = state.charts[key];
      if (!chart || typeof chart.destroy !== 'function') return;
      try { chart.destroy(); } catch (_) {}
      state.charts[key] = null;
    });
  }

  function setGroupUi(groupKey, mode) {
    const loading = document.getElementById(`snapshot-${groupKey}-loading`);
    const error = document.getElementById(`snapshot-${groupKey}-error`);
    const ready = document.getElementById(`snapshot-${groupKey}-ready`);
    if (loading) loading.classList.toggle('is-hidden', mode !== 'loading');
    if (error) error.classList.toggle('is-hidden', mode !== 'error');
    if (ready) ready.classList.toggle('is-hidden', mode !== 'ready');
  }

  function setAllGroups(mode) {
    setGroupUi('revenue-cost', mode);
    setGroupUi('performance', mode);
    setGroupUi('customers', mode);
  }

  function setUnauthorizedView(isUnauthorized) {
    const card = document.getElementById('snapshot-not-authorized');
    const content = document.getElementById('snapshot-content');
    const toolbar = document.querySelector('.snapshot-toolbar-card');
    if (card) card.classList.toggle('is-hidden', !isUnauthorized);
    if (content) content.classList.toggle('is-hidden', !!isUnauthorized);
    if (toolbar) toolbar.classList.toggle('is-hidden', !!isUnauthorized);
  }

  function setCustomRangeVisible(show) {
    const wraps = document.querySelectorAll('.snapshot-custom-only');
    wraps.forEach((el) => {
      if (!el || !el.classList) return;
      el.classList.toggle('is-hidden', !show);
    });
  }

  function getDeltaInfo(valueRaw, previousRaw) {
    const value = toNumber(valueRaw);
    const previous = toNumber(previousRaw);
    if (value == null || previous == null) return { delta: null, deltaPct: null, tone: 'flat' };
    const delta = value - previous;
    let deltaPct = null;
    if (Math.abs(previous) > 0) {
      deltaPct = (delta / Math.abs(previous)) * 100;
    }
    const tone = delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat');
    return { delta, deltaPct, tone };
  }

  function metricRow(label, metric, type, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const value = metric && metric.value != null ? metric.value : null;
    const previous = metric && metric.previous != null ? metric.previous : null;
    const deltaInfo = getDeltaInfo(value, previous);
    let thisText = '-';
    let prevText = '-';
    let deltaText = '-';
    if (type === 'currency') {
      thisText = fmtCurrency(value);
      prevText = fmtCurrency(previous);
      deltaText = deltaInfo.delta == null ? '-' : fmtCurrency(deltaInfo.delta);
    } else if (type === 'percent') {
      thisText = fmtPercent(value);
      prevText = fmtPercent(previous);
      deltaText = deltaInfo.delta == null ? '-' : fmtPercent(deltaInfo.delta);
    } else if (type === 'roas') {
      thisText = fmtRoas(value);
      prevText = fmtRoas(previous);
      deltaText = deltaInfo.delta == null ? '-' : fmtRoas(deltaInfo.delta);
    } else {
      thisText = fmtInt(value);
      prevText = fmtInt(previous);
      deltaText = deltaInfo.delta == null ? '-' : fmtInt(deltaInfo.delta);
    }
    const badgeClass = `snapshot-delta snapshot-delta--${deltaInfo.tone}`;
    const deltaPctText = deltaInfo.deltaPct == null ? '-' : fmtDeltaPercent(deltaInfo.deltaPct);
    const rowClass = opts.subRow ? 'snapshot-kpi-row snapshot-kpi-row--sub' : 'snapshot-kpi-row';
    const labelClass = opts.subRow ? 'text-muted snapshot-kpi-sub-label' : 'text-muted';
    return '' +
      `<tr class="${rowClass}">` +
        `<th scope="row" class="${labelClass}">${esc(label)}</th>` +
        `<td class="text-end">${esc(thisText)}</td>` +
        `<td class="text-end">${esc(prevText)}</td>` +
        `<td class="text-end"><span class="${badgeClass}">${esc(deltaText)}</span></td>` +
        `<td class="text-end"><span class="${badgeClass}">${esc(deltaPctText)}</span></td>` +
      '</tr>';
  }

  function costBreakdownToMap(lines) {
    const map = new Map();
    const rows = Array.isArray(lines) ? lines : [];
    rows.forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const label = String(row.label || '').trim();
      if (!label) return;
      const amount = toNumber(row.amountGbp);
      if (amount == null) return;
      map.set(label, (Number(map.get(label) || 0) || 0) + amount);
    });
    return map;
  }

  function renderCostBreakdownRows(financial) {
    const nowMap = costBreakdownToMap(financial && financial.costBreakdownNow);
    const prevMap = costBreakdownToMap(financial && financial.costBreakdownPrevious);
    const labels = [];
    const seen = new Set();
    for (const label of nowMap.keys()) {
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
    for (const label of prevMap.keys()) {
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
    if (!labels.length) return '';
    let html = '';
    labels.forEach((label) => {
      const now = toNumber(nowMap.get(label));
      const prev = toNumber(prevMap.get(label));
      html += metricRow(
        label,
        { value: now == null ? 0 : now, previous: prev == null ? 0 : prev },
        'currency',
        { subRow: true }
      );
    });
    return html;
  }

  function shouldShowProfit(data) {
    const profit = data && data.financial && data.financial.profit ? data.financial.profit : {};
    const configured = !!(profit && profit.enabled === true && (profit.hasEnabledRules === true || profit.hasEnabledIntegration === true));
    return configured && profit.visible === true;
  }

  function renderRevenueCostTable(data) {
    const body = document.getElementById('snapshot-revenue-cost-table-body');
    if (!body) return;
    const financial = data && data.financial ? data.financial : {};
    let html = '';
    html += metricRow('Revenue', financial.revenue, 'currency');
    html += metricRow('Cost', financial.cost, 'currency');
    html += renderCostBreakdownRows(financial);
    if (shouldShowProfit(data)) {
      const profit = financial.profit || {};
      html += metricRow('Estimated Profit', profit.estimatedProfit, 'currency');
      html += metricRow('Net Profit', profit.netProfit, 'currency');
      html += metricRow('Profit Margin', profit.marginPct, 'percent');
      html += metricRow('Deductions', profit.deductions, 'currency');
    }
    body.innerHTML = html;
  }

  function renderPerformanceTable(data) {
    const body = document.getElementById('snapshot-performance-table-body');
    if (!body) return;
    const perf = data && data.performance ? data.performance : {};
    let html = '';
    html += metricRow('Sessions', perf.sessions, 'count');
    html += metricRow('Orders', perf.orders, 'count');
    html += metricRow('Conversion Rate', perf.conversionRate, 'percent');
    html += metricRow('AOV', perf.aov, 'currency');
    if ((perf.clicks && (perf.clicks.value != null || perf.clicks.previous != null))) {
      html += metricRow('Clicks', perf.clicks, 'count');
    }
    if ((perf.roas && (perf.roas.value != null || perf.roas.previous != null))) {
      html += metricRow('ROAS', perf.roas, 'roas');
    }
    body.innerHTML = html;
  }

  function renderCustomersTable(data) {
    const body = document.getElementById('snapshot-customers-table-body');
    if (!body) return;
    const customers = data && data.customers ? data.customers : {};
    let html = '';
    html += metricRow('New Customers', customers.newCustomers, 'count');
    html += metricRow('Returning Customers', customers.returningCustomers, 'count');
    html += metricRow('Repeat Purchase Rate', customers.repeatPurchaseRate, 'percent');
    html += metricRow('LTV', customers.ltv, 'currency');
    body.innerHTML = html;
  }

  function buildCategoriesFromLabels(labels) {
    const src = Array.isArray(labels) ? labels : [];
    return src.map((ymd) => {
      const d = ymdToDate(ymd);
      if (!d) return String(ymd || '');
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    });
  }

  function alignPair(current, previous) {
    const curr = Array.isArray(current) ? current : [];
    const prev = Array.isArray(previous) ? previous : [];
    const len = Math.max(curr.length, prev.length);
    const outCurrent = [];
    const outPrevious = [];
    for (let i = 0; i < len; i += 1) {
      outCurrent.push(i < curr.length ? curr[i] : null);
      outPrevious.push(i < prev.length ? prev[i] : null);
    }
    return { current: outCurrent, previous: outPrevious, len };
  }

  function renderChart(key, elId, options) {
    const el = document.getElementById(elId);
    if (!el || typeof window.ApexCharts === 'undefined') return;
    if (state.charts[key] && typeof state.charts[key].destroy === 'function') {
      try { state.charts[key].destroy(); } catch (_) {}
      state.charts[key] = null;
    }
    el.innerHTML = '';
    const doRender = function doRender() {
      try {
        const chart = new window.ApexCharts(el, options);
        chart.render();
        state.charts[key] = chart;
      } catch (_) {}
    };
    if (typeof window.kexoWaitForContainerDimensions === 'function') {
      window.kexoWaitForContainerDimensions(el, doRender);
    } else {
      doRender();
    }
  }

  function renderRevenueCostChart(data) {
    const comparison = data && data.seriesComparison ? data.seriesComparison : {};
    const current = comparison.current || {};
    const previous = comparison.previous || {};
    const alignedRevenue = alignPair(current.revenueGbp, previous.revenueGbp);
    const alignedCost = alignPair(current.costGbp, previous.costGbp);
    const len = Math.max(alignedRevenue.len, alignedCost.len);
    const labels = buildCategoriesFromLabels(current.labelsYmd);
    while (labels.length < len) labels.push(`P${labels.length + 1}`);
    renderChart('revenueCost', 'snapshot-chart-revenue-cost', {
      chart: { type: 'line', height: 320, toolbar: { show: false }, animations: { enabled: true } },
      stroke: { width: [3, 3, 2, 2], curve: 'smooth', dashArray: [0, 0, 6, 6] },
      colors: ['#206bc4', '#d63939', '#6ea8fe', '#f59f9f'],
      dataLabels: { enabled: false },
      series: [
        { name: 'Revenue (This)', data: alignedRevenue.current },
        { name: 'Cost (This)', data: alignedCost.current },
        { name: 'Revenue (Previous)', data: alignedRevenue.previous },
        { name: 'Cost (Previous)', data: alignedCost.previous },
      ],
      xaxis: { categories: labels },
      yaxis: {
        labels: { formatter: (v) => fmtCurrency(v) },
      },
      tooltip: {
        y: { formatter: (v) => fmtCurrency(v) },
      },
      legend: { show: true, position: 'top' },
      grid: { strokeDashArray: 3 },
    });
  }

  function renderPerformanceChart(data) {
    const key = String(state.performanceMetric || 'sessions');
    const comparison = data && data.seriesComparison ? data.seriesComparison : {};
    const current = comparison.current || {};
    const previous = comparison.previous || {};
    const aligned = alignPair(current[key], previous[key]);
    const labels = buildCategoriesFromLabels(current.labelsYmd);
    while (labels.length < aligned.len) labels.push(`P${labels.length + 1}`);
    const valueFormat = function valueFormat(v) {
      if (key === 'conversionRate') return fmtPercent(v);
      if (key === 'aov') return fmtCurrency(v);
      if (key === 'roas') return fmtRoas(v);
      return fmtInt(v);
    };
    const title = key === 'conversionRate'
      ? 'Conversion Rate'
      : (key === 'aov' ? 'AOV' : (key === 'roas' ? 'ROAS' : (key === 'clicks' ? 'Clicks' : (key === 'orders' ? 'Orders' : 'Sessions'))));
    renderChart('performance', 'snapshot-chart-performance', {
      chart: { type: 'line', height: 300, toolbar: { show: false }, animations: { enabled: true } },
      stroke: { width: [3, 2], curve: 'smooth', dashArray: [0, 6] },
      colors: ['#2fb344', '#9ca3af'],
      dataLabels: { enabled: false },
      series: [
        { name: `${title} (This)`, data: aligned.current },
        { name: `${title} (Previous)`, data: aligned.previous },
      ],
      xaxis: { categories: labels },
      yaxis: {
        labels: { formatter: valueFormat },
      },
      tooltip: {
        y: { formatter: valueFormat },
      },
      legend: { show: true, position: 'top' },
      grid: { strokeDashArray: 3 },
    });
  }

  function renderCustomersChart(data) {
    const comparison = data && data.seriesComparison ? data.seriesComparison : {};
    const current = comparison.current || {};
    const previous = comparison.previous || {};
    const alignedNew = alignPair(current.newCustomers, previous.newCustomers);
    const alignedReturning = alignPair(current.returningCustomers, previous.returningCustomers);
    const len = Math.max(alignedNew.len, alignedReturning.len);
    const labels = buildCategoriesFromLabels(current.labelsYmd);
    while (labels.length < len) labels.push(`P${labels.length + 1}`);
    renderChart('customers', 'snapshot-chart-customers', {
      chart: { type: 'line', height: 300, toolbar: { show: false }, animations: { enabled: true } },
      stroke: { width: [3, 3, 2, 2], curve: 'smooth', dashArray: [0, 0, 6, 6] },
      colors: ['#206bc4', '#f59f00', '#6ea8fe', '#f9cb80'],
      dataLabels: { enabled: false },
      series: [
        { name: 'New Customers (This)', data: alignedNew.current },
        { name: 'Returning Customers (This)', data: alignedReturning.current },
        { name: 'New Customers (Previous)', data: alignedNew.previous },
        { name: 'Returning Customers (Previous)', data: alignedReturning.previous },
      ],
      xaxis: { categories: labels },
      yaxis: { labels: { formatter: (v) => fmtInt(v) } },
      tooltip: { y: { formatter: (v) => fmtInt(v) } },
      legend: { show: true, position: 'top' },
      grid: { strokeDashArray: 3 },
    });
  }

  function renderCompareLine(data) {
    const line = document.getElementById('snapshot-compare-line');
    if (!line) return;
    const range = data && data.sources && data.sources.rangeYmd ? data.sources.rangeYmd : {};
    const compare = data && data.sources && data.sources.compareRangeYmd ? data.sources.compareRangeYmd : {};
    const thisLabel = formatDateSpan(range.since || state.since, range.until || state.until);
    const previousLabel = formatDateSpan(compare.since || '-', compare.until || '-');
    line.textContent = `${presetLabel(state.preset)} (${thisLabel}) compared with previous period (${previousLabel})`;
  }

  function renderSourcesNote(data) {
    const note = document.getElementById('snapshot-sources-note');
    if (!note) return;
    note.classList.add('is-hidden');
    note.textContent = '';

    const sources = data && data.sources ? data.sources : {};
    const shopifyPaymentsDetail = sources && sources.shopifyPaymentsDetail ? sources.shopifyPaymentsDetail : {};
    const current = shopifyPaymentsDetail && shopifyPaymentsDetail.current ? shopifyPaymentsDetail.current : null;
    const previous = shopifyPaymentsDetail && shopifyPaymentsDetail.previous ? shopifyPaymentsDetail.previous : null;

    const financial = data && data.financial ? data.financial : {};
    const lines = Array.isArray(financial.costBreakdownNow) ? financial.costBreakdownNow : [];
    const feeToggleInUse = lines.some((row) => {
      const label = String(row && row.label || '').toLowerCase();
      return label.includes('shopify app bills')
        || label.includes('transaction fees')
        || label.includes('shopify fees');
    });
    if (!feeToggleInUse) return;

    const lineAmount = (needle) => {
      const row = lines.find((entry) => String(entry && entry.label || '').toLowerCase().includes(needle));
      return row ? Number(row.amountGbp || 0) || 0 : 0;
    };
    const appBillsNow = lineAmount('shopify app bills');
    const shopifyFeesNow = lineAmount('shopify fees');
    const categoryZeroHint = appBillsNow <= 0 && shopifyFeesNow <= 0;

    const currentError = current && current.error ? String(current.error).trim() : '';
    const previousError = previous && previous.error ? String(previous.error).trim() : '';
    const anyUnavailable = !!((current && current.available === false) || (previous && previous.available === false));
    const anyError = !!(currentError || previousError);

    const summarizeDiagnostics = (diag, prefix) => {
      if (!diag || typeof diag !== 'object') return '';
      const topTypes = Array.isArray(diag.topTypes) ? diag.topTypes.slice(0, 4) : [];
      if (!topTypes.length) return '';
      const rowBits = topTypes
        .map((row) => `${String(row && row.key || 'unknown')} (${fmtInt(Number(row && row.count) || 0)})`)
        .join(', ');
      return `${prefix}: ${rowBits}`;
    };
    const currentDiag = current && current.diagnostics ? current.diagnostics : null;
    const previousDiag = previous && previous.diagnostics ? previous.diagnostics : null;
    const diagnosticsSummary = [
      summarizeDiagnostics(currentDiag, 'current types'),
      summarizeDiagnostics(previousDiag, 'previous types'),
    ].filter(Boolean).join(' | ');

    if (!anyUnavailable && !anyError) {
      if (!categoryZeroHint || !diagnosticsSummary) return;
      note.textContent = `Shopify fee diagnostics: ${diagnosticsSummary}`;
      note.classList.remove('is-hidden');
      return;
    }

    const details = [];
    if (currentError) details.push(`current: ${currentError}`);
    if (previousError) details.push(`previous: ${previousError}`);
    const detailText = details.join(' | ');

    if (/access denied|forbidden|scope|permission/i.test(detailText)) {
      note.textContent = detailText
        ? `Shopify fee data unavailable. Reconnect Shopify with read_shopify_payments scope in Settings > Integrations. (${detailText})`
        : 'Shopify fee data unavailable. Reconnect Shopify with read_shopify_payments scope in Settings > Integrations.';
    } else if (detailText) {
      note.textContent = diagnosticsSummary
        ? `Shopify fee diagnostics: ${detailText} | ${diagnosticsSummary}`
        : `Shopify fee diagnostics: ${detailText}`;
    } else {
      note.textContent = 'Shopify fee data unavailable for this shop or date range.';
    }
    note.classList.remove('is-hidden');
  }

  function renderAll(data) {
    if (!data || data.ok !== true) {
      setAllGroups('error');
      return;
    }
    state.data = data;
    renderCompareLine(data);
    renderSourcesNote(data);
    renderRevenueCostTable(data);
    renderPerformanceTable(data);
    renderCustomersTable(data);
    if (state.showGraphs.revenueCost) renderRevenueCostChart(data);
    if (state.showGraphs.performance) renderPerformanceChart(data);
    if (state.showGraphs.customers) renderCustomersChart(data);
    setAllGroups('ready');
  }

  function toggleSnapshotGraph(key) {
    const wrap = document.querySelector('[data-snapshot-graph-wrap="' + key + '"]');
    const btn = document.querySelector('.snapshot-show-graph-btn[data-snapshot-graph="' + key + '"]');
    if (!wrap || !btn) return;
    state.showGraphs[key] = !state.showGraphs[key];
    if (state.showGraphs[key]) {
      wrap.classList.remove('is-hidden');
      btn.textContent = 'Hide graph';
      if (state.data && state.data.ok) {
        if (key === 'revenueCost') renderRevenueCostChart(state.data);
        else if (key === 'performance') renderPerformanceChart(state.data);
        else if (key === 'customers') renderCustomersChart(state.data);
      }
    } else {
      if (state.charts[key] && typeof state.charts[key].destroy === 'function') {
        try { state.charts[key].destroy(); } catch (_) {}
        state.charts[key] = null;
      }
      wrap.classList.add('is-hidden');
      btn.textContent = 'Show graph';
    }
  }

  function updateRoundingToggleUi() {
    const link = document.getElementById('snapshot-rounding-toggle');
    if (!link) return;
    link.textContent = 'Rounding Numbers. Switch?';
    link.setAttribute(
      'title',
      state.compactNumbers
        ? 'Rounded numbers are ON. Click to show full values.'
        : 'Rounded numbers are OFF. Click to show compact values.'
    );
    link.setAttribute(
      'aria-label',
      state.compactNumbers
        ? 'Rounded numbers are on. Switch to full values.'
        : 'Rounded numbers are off. Switch to rounded values.'
    );
  }

  function buildSnapshotApiUrl(force) {
    const params = new URLSearchParams();
    params.set('mode', 'range');
    params.set('since', state.since);
    params.set('until', state.until);
    params.set('preset', state.preset);
    if (force) params.set('_', String(Date.now()));
    return `${API}/api/business-snapshot?${params.toString()}`;
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {}));
    if (res.status === 403) {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function fetchSnapshot(force) {
    if (!state.authorized) {
      setUnauthorizedView(true);
      return;
    }
    state.loading = true;
    setAllGroups('loading');
    const reqId = ++state.requestId;
    try {
      const payload = await fetchJson(buildSnapshotApiUrl(force));
      if (reqId !== state.requestId) return;
      renderAll(payload);
    } catch (err) {
      if (reqId !== state.requestId) return;
      if (err && err.status === 403) {
        state.authorized = false;
        setUnauthorizedView(true);
        return;
      }
      setAllGroups('error');
    } finally {
      if (reqId === state.requestId) state.loading = false;
    }
  }

  function applyRange(preset, since, until) {
    const normalizedPreset = PRESETS.has(preset) ? preset : 'custom';
    const range = clampRange(since, until);
    if (!range) return;
    state.preset = normalizedPreset;
    state.since = range.since;
    state.until = range.until;
    const presetEl = document.getElementById('snapshot-preset-select');
    if (presetEl) presetEl.value = state.preset;
    const startEl = document.getElementById('snapshot-custom-start');
    const endEl = document.getElementById('snapshot-custom-end');
    if (startEl) startEl.value = state.since;
    if (endEl) endEl.value = state.until;
    setCustomRangeVisible(state.preset === 'custom');
    syncUrl();
    fetchSnapshot(false);
  }

  function onPresetChange() {
    const presetEl = document.getElementById('snapshot-preset-select');
    const selected = presetEl ? String(presetEl.value || '').toLowerCase() : 'this_month';
    if (!PRESETS.has(selected)) return;
    if (selected === 'custom') {
      state.preset = 'custom';
      setCustomRangeVisible(true);
      syncUrl();
      return;
    }
    const range = computePresetRange(selected, getTodayYmd());
    applyRange(selected, range.since, range.until);
  }

  function onApplyCustomRange() {
    const startEl = document.getElementById('snapshot-custom-start');
    const endEl = document.getElementById('snapshot-custom-end');
    const since = startEl ? String(startEl.value || '').slice(0, 10) : '';
    const until = endEl ? String(endEl.value || '').slice(0, 10) : '';
    const range = clampRange(since, until);
    if (!range) return;
    applyRange('custom', range.since, range.until);
  }

  function openProfitRulesModal() {
    const modal = document.getElementById('profit-rules-modal');
    if (!modal) return;
    if (state.profitModalOpen) return;
    state.profitModalOpen = true;
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade show';
    backdrop.addEventListener('click', closeProfitRulesModal);
    document.body.appendChild(backdrop);
    state.profitModalBackdrop = backdrop;
  }

  function closeProfitRulesModal() {
    const modal = document.getElementById('profit-rules-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    if (state.profitModalBackdrop && state.profitModalBackdrop.parentNode) {
      state.profitModalBackdrop.parentNode.removeChild(state.profitModalBackdrop);
    }
    state.profitModalBackdrop = null;
    state.profitModalOpen = false;
    document.body.classList.remove('modal-open');
  }

  function createRuleId() {
    return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function normalizeCountryCode(value) {
    const raw = String(value || '').trim().toUpperCase().slice(0, 2);
    if (!raw) return '';
    const cc = raw === 'UK' ? 'GB' : raw;
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    return cc;
  }

  function normalizeRulesPayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const list = Array.isArray(src.rules) ? src.rules : [];
    const out = {
      enabled: !!src.enabled,
      currency: 'GBP',
      integrations: {
        includeGoogleAdsSpend: !!(src.integrations && src.integrations.includeGoogleAdsSpend === true),
        includeShopifyAppBills: false,
        includePaymentFees: !!(src.integrations && src.integrations.includePaymentFees === true),
        includeKlarnaFees: !!(src.integrations && src.integrations.includeKlarnaFees === true),
      },
      rules: [],
    };
    for (let i = 0; i < list.length; i += 1) {
      const row = list[i] && typeof list[i] === 'object' ? list[i] : {};
      const appliesMode = row.appliesTo && row.appliesTo.mode === 'countries' ? 'countries' : 'all';
      const countries = appliesMode === 'countries' && Array.isArray(row.appliesTo.countries)
        ? row.appliesTo.countries.map(normalizeCountryCode).filter(Boolean)
        : [];
      out.rules.push({
        id: row.id ? String(row.id) : createRuleId(),
        name: row.name ? String(row.name) : 'Expense',
        type: row.type ? String(row.type) : 'percent_revenue',
        value: Number.isFinite(Number(row.value)) ? Number(row.value) : 0,
        enabled: row.enabled !== false,
        sort: Number.isFinite(Number(row.sort)) ? Math.trunc(Number(row.sort)) : (i + 1),
        appliesTo: appliesMode === 'countries' && countries.length
          ? { mode: 'countries', countries: countries.slice(0, 64) }
          : { mode: 'all', countries: [] },
      });
    }
    out.rules.sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0));
    return out;
  }

  function setRulesMessage(text, isOk) {
    const el = document.getElementById('profit-rules-msg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-hidden', !text);
    el.classList.toggle('text-success', !!isOk);
    el.classList.toggle('text-danger', isOk === false);
  }

  function sortRulesDraft() {
    if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules)) return;
    state.rulesDraft.rules.sort((a, b) => {
      const sa = Number(a && a.sort != null ? a.sort : 0) || 0;
      const sb = Number(b && b.sort != null ? b.sort : 0) || 0;
      if (sa !== sb) return sa - sb;
      return String(a && a.id || '').localeCompare(String(b && b.id || ''));
    });
  }

  function reindexRulesDraft() {
    if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules)) return;
    sortRulesDraft();
    state.rulesDraft.rules.forEach((rule, idx) => {
      if (!rule) return;
      rule.sort = idx + 1;
    });
  }

  function getRuleById(ruleId) {
    if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules)) return null;
    return state.rulesDraft.rules.find((rule) => String(rule && rule.id || '') === String(ruleId || '')) || null;
  }

  function ruleTypeLabel(type) {
    if (type === 'fixed_per_order') return 'Fixed per order';
    if (type === 'fixed_per_period') return 'Fixed per period';
    return 'Percent of revenue';
  }

  function ruleValueLabel(rule) {
    if (!rule) return '-';
    const value = Number(rule.value);
    if (!Number.isFinite(value)) return '-';
    if (rule.type === 'percent_revenue') return `${value.toFixed(2).replace(/\.00$/, '')}%`;
    return fmtCurrency(value);
  }

  function renderRulesList() {
    const bodyEl = document.getElementById('profit-rules-table-body');
    if (!bodyEl) return;
    if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules) || !state.rulesDraft.rules.length) {
      bodyEl.innerHTML = '<tr><td colspan="6" class="text-muted">No rules yet.</td></tr>';
      return;
    }
    sortRulesDraft();
    let html = '';
    state.rulesDraft.rules.forEach((rule, idx) => {
      const countryLabel = rule && rule.appliesTo && rule.appliesTo.mode === 'countries'
        ? ((rule.appliesTo.countries || []).join(', ') || '-')
        : 'ALL';
      html += '' +
        `<tr data-rule-id="${esc(rule.id || '')}">` +
          `<td>${esc(rule.name || 'Expense')}</td>` +
          `<td>${esc(ruleTypeLabel(rule.type))}</td>` +
          `<td class="text-end">${esc(ruleValueLabel(rule))}</td>` +
          `<td class="text-center">${esc(countryLabel)}</td>` +
          '<td class="text-center">' +
            `<input type="checkbox" data-pr-action="toggle-enabled" data-rule-id="${esc(rule.id || '')}" ${rule.enabled ? 'checked' : ''} />` +
          '</td>' +
          '<td class="text-end text-nowrap">' +
            `<button type="button" class="btn btn-sm btn-ghost-secondary" data-pr-action="move-up" data-rule-id="${esc(rule.id || '')}" ${idx <= 0 ? 'disabled' : ''}>Up</button> ` +
            `<button type="button" class="btn btn-sm btn-ghost-secondary" data-pr-action="move-down" data-rule-id="${esc(rule.id || '')}" ${idx >= state.rulesDraft.rules.length - 1 ? 'disabled' : ''}>Down</button> ` +
            `<button type="button" class="btn btn-sm btn-ghost-secondary" data-pr-action="edit" data-rule-id="${esc(rule.id || '')}">Edit</button> ` +
            `<button type="button" class="btn btn-sm btn-ghost-danger" data-pr-action="delete" data-rule-id="${esc(rule.id || '')}">Delete</button>` +
          '</td>' +
        '</tr>';
    });
    bodyEl.innerHTML = html;
  }

  function hideRulesForm() {
    const panel = document.getElementById('profit-rules-form-wrap');
    if (panel) panel.classList.add('is-hidden');
    state.editingRuleId = '';
    const idEl = document.getElementById('profit-rule-id');
    if (idEl) idEl.value = '';
  }

  function showRulesForm(rule) {
    const panel = document.getElementById('profit-rules-form-wrap');
    if (panel) panel.classList.remove('is-hidden');
    state.editingRuleId = rule ? String(rule.id || '') : '';
    const idEl = document.getElementById('profit-rule-id');
    const nameEl = document.getElementById('profit-rule-name');
    const typeEl = document.getElementById('profit-rule-type');
    const valueEl = document.getElementById('profit-rule-value');
    const countryEl = document.getElementById('profit-rule-country');
    const sortEl = document.getElementById('profit-rule-sort');
    const enabledEl = document.getElementById('profit-rule-enabled');
    if (idEl) idEl.value = state.editingRuleId;
    if (nameEl) nameEl.value = rule ? (rule.name || '') : '';
    if (typeEl) typeEl.value = rule ? (rule.type || 'percent_revenue') : 'percent_revenue';
    if (valueEl) valueEl.value = rule && rule.value != null ? String(Number(rule.value) || 0) : '';
    if (countryEl) countryEl.value = rule && rule.appliesTo && rule.appliesTo.mode === 'countries'
      ? (rule.appliesTo.countries || []).join(',')
      : '';
    if (sortEl) sortEl.value = rule && Number.isFinite(Number(rule.sort)) ? String(Math.trunc(Number(rule.sort))) : String((state.rulesDraft && state.rulesDraft.rules ? state.rulesDraft.rules.length + 1 : 1));
    if (enabledEl) enabledEl.checked = rule ? (rule.enabled !== false) : true;
  }

  function readRuleForm() {
    const nameEl = document.getElementById('profit-rule-name');
    const typeEl = document.getElementById('profit-rule-type');
    const valueEl = document.getElementById('profit-rule-value');
    const countryEl = document.getElementById('profit-rule-country');
    const sortEl = document.getElementById('profit-rule-sort');
    const enabledEl = document.getElementById('profit-rule-enabled');
    const name = String(nameEl && nameEl.value || '').trim();
    if (!name) return { ok: false, error: 'Rule name is required.' };
    const type = String(typeEl && typeEl.value || '').trim();
    if (!['percent_revenue', 'fixed_per_order', 'fixed_per_period'].includes(type)) {
      return { ok: false, error: 'Rule type is invalid.' };
    }
    const value = Number(valueEl && valueEl.value);
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: 'Value must be 0 or higher.' };
    const sort = Math.max(1, Math.trunc(Number(sortEl && sortEl.value) || 1));
    const countryRaw = String(countryEl && countryEl.value || '').trim();
    let appliesTo = { mode: 'all', countries: [] };
    if (countryRaw) {
      const countries = countryRaw.split(/[,\s]+/).map(normalizeCountryCode).filter(Boolean);
      if (!countries.length) return { ok: false, error: 'Use valid 2-letter ISO country codes.' };
      const unique = [];
      const seen = new Set();
      countries.forEach((cc) => {
        if (!cc || seen.has(cc)) return;
        seen.add(cc);
        unique.push(cc);
      });
      appliesTo = { mode: 'countries', countries: unique.slice(0, 64) };
    }
    return {
      ok: true,
      rule: {
        id: state.editingRuleId || createRuleId(),
        name: name.slice(0, 80),
        type,
        value,
        enabled: enabledEl ? !!enabledEl.checked : true,
        sort,
        appliesTo,
      },
    };
  }

  function saveRuleDraft() {
    const parsed = readRuleForm();
    if (!parsed.ok) {
      setRulesMessage(parsed.error, false);
      return;
    }
    if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules)) {
      state.rulesDraft = normalizeRulesPayload(null);
    }
    const existing = getRuleById(parsed.rule.id);
    if (existing) {
      existing.name = parsed.rule.name;
      existing.type = parsed.rule.type;
      existing.value = parsed.rule.value;
      existing.enabled = parsed.rule.enabled;
      existing.sort = parsed.rule.sort;
      existing.appliesTo = parsed.rule.appliesTo;
    } else {
      state.rulesDraft.rules.push(parsed.rule);
    }
    reindexRulesDraft();
    renderRulesList();
    hideRulesForm();
    setRulesMessage('Rule saved in draft.', true);
  }

  async function loadProfitRules(force) {
    let url = `${API}/api/settings/profit-rules`;
    if (force) {
      const mark = url.includes('?') ? '&' : '?';
      url += `${mark}_=${Date.now()}`;
    }
    const payload = await fetchJson(url);
    state.rulesDraft = normalizeRulesPayload(payload && payload.profitRules ? payload.profitRules : null);
    const enabledToggle = document.getElementById('profit-rules-enabled');
    const adsToggle = document.getElementById('profit-rules-include-google-ads');
    const paymentFeesToggle = document.getElementById('profit-rules-include-payment-fees');
    const klarnaFeesToggle = document.getElementById('profit-rules-include-klarna-fees');
    if (enabledToggle) enabledToggle.checked = !!(state.rulesDraft && state.rulesDraft.enabled);
    if (adsToggle) adsToggle.checked = !!(state.rulesDraft && state.rulesDraft.integrations && state.rulesDraft.integrations.includeGoogleAdsSpend);
    if (paymentFeesToggle) paymentFeesToggle.checked = !!(state.rulesDraft && state.rulesDraft.integrations && state.rulesDraft.integrations.includePaymentFees);
    if (klarnaFeesToggle) klarnaFeesToggle.checked = !!(state.rulesDraft && state.rulesDraft.integrations && state.rulesDraft.integrations.includeKlarnaFees);
    renderRulesList();
    hideRulesForm();
  }

  async function saveProfitRules() {
    if (!state.rulesDraft) state.rulesDraft = normalizeRulesPayload(null);
    const enabledToggle = document.getElementById('profit-rules-enabled');
    const adsToggle = document.getElementById('profit-rules-include-google-ads');
    const paymentFeesToggle = document.getElementById('profit-rules-include-payment-fees');
    const klarnaFeesToggle = document.getElementById('profit-rules-include-klarna-fees');
    state.rulesDraft.enabled = enabledToggle ? !!enabledToggle.checked : !!state.rulesDraft.enabled;
    if (!state.rulesDraft.integrations || typeof state.rulesDraft.integrations !== 'object') {
      state.rulesDraft.integrations = {
        includeGoogleAdsSpend: false,
        includeShopifyAppBills: false,
        includePaymentFees: false,
        includeKlarnaFees: false,
      };
    }
    state.rulesDraft.integrations.includeGoogleAdsSpend = adsToggle ? !!adsToggle.checked : !!state.rulesDraft.integrations.includeGoogleAdsSpend;
    state.rulesDraft.integrations.includeShopifyAppBills = false;
    state.rulesDraft.integrations.includePaymentFees = paymentFeesToggle ? !!paymentFeesToggle.checked : !!state.rulesDraft.integrations.includePaymentFees;
    state.rulesDraft.integrations.includeKlarnaFees = klarnaFeesToggle ? !!klarnaFeesToggle.checked : !!state.rulesDraft.integrations.includeKlarnaFees;
    reindexRulesDraft();
    setRulesMessage('Saving...', true);
    try {
      const payload = await fetchJson(`${API}/api/settings/profit-rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profitRules: state.rulesDraft }),
      });
      state.rulesDraft = normalizeRulesPayload(payload && payload.profitRules ? payload.profitRules : state.rulesDraft);
      renderRulesList();
      setRulesMessage('Profit rules saved.', true);
      await fetchSnapshot(true);
    } catch (_) {
      setRulesMessage('Failed to save profit rules.', false);
    }
  }

  function setProfitRulesTab(tab) {
    const key = tab === 'integrations' ? 'integrations' : 'rules';
    const tabButtons = document.querySelectorAll('[data-pr-tab]');
    tabButtons.forEach((btn) => {
      if (!btn || !btn.classList) return;
      const v = String(btn.getAttribute('data-pr-tab') || '');
      btn.classList.toggle('active', v === key);
    });
    const rulesPane = document.getElementById('profit-rules-tab-rules');
    const integrationsPane = document.getElementById('profit-rules-tab-integrations');
    if (rulesPane) rulesPane.classList.toggle('is-hidden', key !== 'rules');
    if (integrationsPane) integrationsPane.classList.toggle('is-hidden', key !== 'integrations');
  }

  function bindProfitRulesUi() {
    const openBtn = document.getElementById('snapshot-profit-settings-btn');
    const closeBtn = document.getElementById('profit-rules-close-btn');
    const dismissBtn = document.getElementById('profit-rules-dismiss-btn');
    const saveBtn = document.getElementById('profit-rules-save-btn');
    const addBtn = document.getElementById('profit-rules-add-btn');
    const formSaveBtn = document.getElementById('profit-rule-save-btn');
    const formCancelBtn = document.getElementById('profit-rule-cancel-btn');
    const tableBody = document.getElementById('profit-rules-table-body');

    if (openBtn) {
      openBtn.addEventListener('click', async function onOpenProfitRules() {
        setRulesMessage('', null);
        try {
          await loadProfitRules(false);
        } catch (_) {
          state.rulesDraft = normalizeRulesPayload(null);
          renderRulesList();
          setRulesMessage('Failed to load existing rules.', false);
        }
        setProfitRulesTab('rules');
        openProfitRulesModal();
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', closeProfitRulesModal);
    if (dismissBtn) dismissBtn.addEventListener('click', closeProfitRulesModal);
    if (saveBtn) saveBtn.addEventListener('click', saveProfitRules);
    if (addBtn) addBtn.addEventListener('click', function onAddRule() { showRulesForm(null); });
    if (formSaveBtn) formSaveBtn.addEventListener('click', saveRuleDraft);
    if (formCancelBtn) formCancelBtn.addEventListener('click', hideRulesForm);

    document.querySelectorAll('[data-pr-tab]').forEach((btn) => {
      btn.addEventListener('click', function onClickTab() {
        const tab = String(btn.getAttribute('data-pr-tab') || '');
        setProfitRulesTab(tab);
      });
    });

    if (tableBody) {
      tableBody.addEventListener('click', function onRuleAction(event) {
        const target = event && event.target ? event.target : null;
        if (!target || !target.getAttribute) return;
        const action = String(target.getAttribute('data-pr-action') || '');
        const ruleId = String(target.getAttribute('data-rule-id') || '');
        if (!action || !ruleId) return;
        if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules)) return;
        if (action === 'edit') {
          showRulesForm(getRuleById(ruleId));
          return;
        }
        if (action === 'delete') {
          state.rulesDraft.rules = state.rulesDraft.rules.filter((rule) => String(rule && rule.id || '') !== ruleId);
          reindexRulesDraft();
          renderRulesList();
          hideRulesForm();
          return;
        }
        if (action === 'move-up' || action === 'move-down') {
          sortRulesDraft();
          const idx = state.rulesDraft.rules.findIndex((rule) => String(rule && rule.id || '') === ruleId);
          if (idx < 0) return;
          const swapWith = action === 'move-up' ? idx - 1 : idx + 1;
          if (swapWith < 0 || swapWith >= state.rulesDraft.rules.length) return;
          const tmp = state.rulesDraft.rules[idx];
          state.rulesDraft.rules[idx] = state.rulesDraft.rules[swapWith];
          state.rulesDraft.rules[swapWith] = tmp;
          reindexRulesDraft();
          renderRulesList();
        }
      });
      tableBody.addEventListener('change', function onRuleToggle(event) {
        const target = event && event.target ? event.target : null;
        if (!target || !target.getAttribute) return;
        const action = String(target.getAttribute('data-pr-action') || '');
        if (action !== 'toggle-enabled') return;
        const ruleId = String(target.getAttribute('data-rule-id') || '');
        const rule = getRuleById(ruleId);
        if (!rule) return;
        rule.enabled = !!target.checked;
      });
    }

    document.addEventListener('keydown', function onModalEscape(event) {
      if (!state.profitModalOpen) return;
      const key = String(event && (event.key || event.code) || '');
      if (key === 'Escape') closeProfitRulesModal();
    });
  }

  function bindUi() {
    const presetEl = document.getElementById('snapshot-preset-select');
    const applyCustomBtn = document.getElementById('snapshot-custom-apply-btn');
    const perfSelect = document.getElementById('snapshot-performance-metric-select');
    const roundingToggle = document.getElementById('snapshot-rounding-toggle');
    const retryButtons = [
      document.getElementById('snapshot-revenue-cost-retry'),
      document.getElementById('snapshot-performance-retry'),
      document.getElementById('snapshot-customers-retry'),
    ];
    if (presetEl) presetEl.addEventListener('change', onPresetChange);
    if (applyCustomBtn) applyCustomBtn.addEventListener('click', onApplyCustomRange);
    if (perfSelect) {
      perfSelect.addEventListener('change', function onPerformanceMetricChange() {
        state.performanceMetric = String(perfSelect.value || 'sessions');
        if (state.showGraphs.performance && state.data && state.data.ok) renderPerformanceChart(state.data);
      });
    }
    document.querySelectorAll('.snapshot-show-graph-btn').forEach(function(btn) {
      var key = btn && btn.getAttribute && btn.getAttribute('data-snapshot-graph');
      if (!key) return;
      btn.addEventListener('click', function() { toggleSnapshotGraph(key); });
      if (state.showGraphs[key]) btn.textContent = 'Hide graph'; else btn.textContent = 'Show graph';
    });
    if (roundingToggle) {
      roundingToggle.addEventListener('click', function onRoundingToggle(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        state.compactNumbers = !state.compactNumbers;
        updateRoundingToggleUi();
        if (state.data && state.data.ok === true) renderAll(state.data);
      });
    }
    retryButtons.forEach((btn) => {
      if (!btn) return;
      btn.addEventListener('click', function onRetry() { fetchSnapshot(true); });
    });
    bindProfitRulesUi();
  }

  function restoreSnapshotHeaderDateLayout() {
    try {
      const body = document.body;
      if (!body || String(body.getAttribute('data-page') || '') !== 'snapshot') return;
      const dateBtn = document.getElementById('kexo-date-display');
      const dateWrap = dateBtn && dateBtn.closest ? dateBtn.closest('.kexo-topbar-date') : null;
      const sourceLi = document.querySelector('.kexo-desktop-nav .kexo-nav-date-slot');
      const headerRow = document.querySelector('.page-header .row.align-items-center') || document.querySelector('.page-header .row');
      if (!dateWrap || !headerRow) return;
      headerRow.classList.add('kexo-page-header-layout-triple');

      let dateCol = headerRow.querySelector('.kexo-page-header-date-col');
      if (!dateCol) {
        dateCol = document.createElement('div');
        dateCol.className = 'col-auto kexo-page-header-date-col';
        headerRow.appendChild(dateCol);
      }
      if (dateWrap.parentElement !== dateCol) dateCol.appendChild(dateWrap);
      if (sourceLi) {
        sourceLi.classList.add('is-date-relocated');
        sourceLi.classList.remove('is-date-inline-fallback');
      }
    } catch (_) {}
  }

  function moveSnapshotMenuItemToBottom() {
    try {
      const menu = document.getElementById('navbar-insights-menu');
      const item = document.getElementById('nav-tab-snapshot');
      if (!menu || !item) return;
      if (item.parentElement !== menu) return;
      menu.appendChild(item);
    } catch (_) {}
  }

  async function init() {
    moveSnapshotMenuItemToBottom();
    restoreSnapshotHeaderDateLayout();
    bindUi();
    updateRoundingToggleUi();
    const initial = parseQueryState();
    state.preset = initial.preset;
    state.since = initial.since;
    state.until = initial.until;
    const presetEl = document.getElementById('snapshot-preset-select');
    const startEl = document.getElementById('snapshot-custom-start');
    const endEl = document.getElementById('snapshot-custom-end');
    if (presetEl) presetEl.value = state.preset;
    if (startEl) startEl.value = state.since;
    if (endEl) endEl.value = state.until;
    setCustomRangeVisible(state.preset === 'custom');
    syncUrl();

    try {
      const me = await fetchJson(`${API}/api/me`);
      state.authorized = isTruthyAdmin(me);
    } catch (_) {
      state.authorized = false;
    }

    if (!state.authorized) {
      setUnauthorizedView(true);
      return;
    }

    setUnauthorizedView(false);
    await fetchSnapshot(false);
  }

  window.addEventListener('pagehide', destroyCharts);
  window.addEventListener('beforeunload', destroyCharts);
  init();
})();
