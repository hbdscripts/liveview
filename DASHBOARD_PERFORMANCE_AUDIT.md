# Dashboard Performance Audit

**Issue:** When minimising Chrome and returning to the tab, the dashboard becomes very laggy and causes high CPU/memory use (fans spin up).

**Date:** 2025-02-19

---

## Executive Summary

When the tab becomes visible again after being minimised or backgrounded, multiple systems fire at once: duplicate visibility handlers, a full dashboard refresh (10+ API calls), ResizeObserver callbacks, and chart re-renders. This creates a burst of work that spikes CPU and memory.

---

## 1. Duplicate Visibility Handlers

**Location:** `client/app/13-live-sales.js` + `client/app/14-dashboard.js`

**Problem:** Two separate `visibilitychange` listeners both trigger a full dashboard refresh when the tab becomes visible:

| Source | Condition | Action |
|--------|-----------|--------|
| 13-live-sales.js | `idleMs < 2 min` | `refreshDashboard({ force: true })` + `refreshKpis({ force: true })` |
| 14-dashboard.js (dashboardController) | tab visible | `refreshOnceAndResume()` → `refreshDashboard({ force: true })` + `startPolling()` |

**Impact:** `refreshDashboard` can be invoked twice in quick succession. The `lastResumeAt` throttle (1s) in `refreshOnceAndResume` helps, but both handlers still run and both call `refreshKpis` / `refreshDashboard` depending on order.

**Recommendation:** Centralise visibility handling. Have 13-live-sales delegate to `dashboardController.onVisibleResume` when on dashboard, and avoid adding a second visibility listener that also triggers refresh. Or add a shared debounce/throttle so only one refresh runs.

---

## 2. Heavy Refresh Cascade on Visibility

**Location:** `client/app/14-dashboard.js` → `fetchDashboardData`

**Problem:** A single `refreshDashboard({ force: true })` triggers all of the following **in parallel**:

| Operation | API/Work |
|-----------|----------|
| Main dashboard | `GET /api/dashboard-series?force=1` |
| Overview chart | `fetchOverviewCardData('dash-chart-overview-30d')` |
| 6 widgets | `requestDashboardWidgetsRefresh` → 6 parallel fetches (finishes, devices, browsers, abandoned, attribution, payment_methods) |
| Live online chart | `refreshLiveOnlineChart()` |
| Kexo score | `fetchKexoScore()` |
| Layout | `ensureOverviewHeightSyncObserver`, `syncOverviewHeightGrid`, `scheduleOverviewHeightSync` |

**Impact:** ~10 concurrent network requests + DOM/layout work + chart setup. When the tab was backgrounded, the browser may have throttled timers; when visible again, everything fires at once.

**Recommendation:**
- **Defer widgets:** Load main dashboard first, then request widgets after render completes (e.g. `requestAnimationFrame` or `setTimeout(0)`).
- **Skip overview chart refresh** when returning from brief hide if data is fresh (e.g. `overviewMiniFetchedAt` within last 2 min).
- **Throttle visibility refresh:** Don’t refresh if tab was hidden &lt; 30 seconds (user likely just switched tabs briefly).

---

## 3. ResizeObserver Cascade on Tab Focus

**Location:** `client/app/14-dashboard.js` (overviewHeightSyncObserver, overviewMiniResizeObserver)

**Problem:** When the tab regains focus, the browser often fires resize events. Multiple ResizeObservers react:

- **overviewHeightSyncObserver** (dash-kpi-grid, dash-kpi-grid-mid) → `scheduleOverviewHeightSync` → `syncOverviewHeightGrid`
- **overviewMiniResizeObserver** (4 chart containers) → `scheduleOverviewMiniResizeRender` → after 300ms → **`rerenderOverviewCardsFromCache`**

`rerenderOverviewCardsFromCache` re-renders **all 4 overview charts** (finishes, devices, attribution, overview). Each uses ApexCharts (create/destroy/update), which is CPU-heavy.

**Impact:** A single resize can trigger 4 full chart re-renders. If the size hasn’t meaningfully changed, this is wasted work.

**Recommendation:**
- **Stricter size check:** `computeOverviewMiniSizeSignature` already quantises to 16px. Skip `rerenderOverviewCardsFromCache` if the quantised size is unchanged.
- **Debounce longer:** 300ms may be too short when multiple resize events fire in quick succession. Consider 500–800ms.
- **Pause observers when hidden:** Disconnect ResizeObservers when `visibilityState === 'hidden'` and reconnect when visible. This avoids resize storms while the tab is in the background.

---

## 4. Chart Re-renders and Memory

**Location:** `client/app/14-dashboard.js` (dashCharts, overview cards)

**Problem:** ApexCharts instances are created/destroyed on re-render. `rerenderOverviewCardsFromCache` calls `renderOverviewCardById` for each chart, which can destroy and recreate charts. Multiple rapid resize events can cause repeated destroy/create cycles.

**Impact:** Chart creation is expensive. Repeated cycles increase GC pressure and CPU.

**Recommendation:**
- Prefer `chart.updateOptions()` over destroy+create when only data or size changes.
- Ensure old chart instances are destroyed before creating new ones (already done in some paths; verify all).

---

## 5. Multiple Intervals / Pollers

**Location:** Various (13-live-sales, 14-dashboard, 08-condensed-kpis, 09-session-top-rows)

**Problem:** Several intervals run regardless of visibility:

| Interval | Period | Purpose |
|----------|--------|---------|
| pollTimer (dashboard) | 120s | Dashboard refresh (today/1h) |
| updateLastSaleAgo | 10s | "X ago" text |
| tickTimeOnSite | 30s | Time display |
| Live sales poll | 10s | Live sales data |

**Impact:** When the tab becomes visible, any pending ticks can fire together. The dashboard correctly stops polling when hidden (`stopPolling` on visibility change), but other intervals may not.

**Recommendation:** Gate all intervals on `document.visibilityState === 'visible'` so they don’t run while the tab is hidden.

---

## 6. Overview Widgets: 6 Parallel Fetches

**Location:** `client/app/14-dashboard.js` → `refreshDashboardWidgetsNow`

**Problem:** Each visibility refresh triggers 6 parallel fetches for widgets. Combined with the main dashboard fetch, that’s 7+ requests at once.

**Recommendation:**
- Add a server endpoint that returns all 6 widget payloads in one response.
- Or lazy-load widgets: fetch main dashboard first, then fetch widgets after the main content has rendered.

---

## 7. Potential ResizeObserver Feedback Loop

**Location:** `client/app/14-dashboard.js`, `server/public/sentry-helpers.js`

**Problem:** Chart rendering can change container dimensions, which triggers ResizeObserver again. The code uses 16px quantisation to reduce this, but it can still occur. Sentry already filters "ResizeObserver loop" errors.

**Recommendation:** Add a guard to ignore resize callbacks that fire within ~100ms of a chart render (e.g. a "lastRenderAt" timestamp).

---

## 8. No Visibility-Based Throttle for Brief Hides

**Location:** `client/app/13-live-sales.js` (visibilitychange)

**Problem:** Any return to the tab within 2 minutes triggers a full refresh. A very short hide (e.g. &lt; 10 seconds) doesn’t need a full refresh.

**Recommendation:** Only refresh when `idleMs > 30 * 1000` (30 seconds). For shorter absences, skip the refresh or only refresh KPIs.

---

## Priority Fixes (Suggested Order)

1. **Throttle visibility refresh** – Skip full refresh if tab was hidden &lt; 30s.
2. **Deduplicate visibility handlers** – Single code path for “tab became visible”.
3. **Pause ResizeObservers when hidden** – Disconnect on hide, reconnect on show.
4. **Defer widget fetches** – Load main dashboard first, then widgets.
5. **Stricter resize debounce** – Longer debounce and skip rerender when size unchanged.
6. **Gate intervals on visibility** – Don’t run when tab is hidden.

---

## Files to Modify

| File | Changes |
|------|---------|
| `client/app/13-live-sales.js` | Throttle visibility refresh; avoid duplicate refresh with dashboard |
| `client/app/14-dashboard.js` | Pause ResizeObservers when hidden; defer widgets; longer resize debounce |
| `client/app/08-condensed-kpis.js` | Gate intervals on visibility |
| `client/app/09-session-top-rows.js` | Gate updateLastSaleAgo on visibility |
