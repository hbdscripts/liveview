# Memory and performance issues (10 + why fans / sluggishness)

**Context:** Fans kick in when re-visiting the Chrome tab; the app can feel sluggish. This doc lists **10 memory/leak issues** and ties them to **why the tab revisit spikes CPU** and **why the app feels sluggish**.

**Status (2026-02-22):** Implemented the concrete accumulating-listener / observer lifecycle fixes called out here (notably **#1, #3, #4**) and rebuilt `server/public/app.js`. The remaining items are primarily “work burst”/scheduling optimisations already partially addressed in code (visibility throttles, observer pause/resume, stricter resize debounce), and can be iterated further if you want more smoothing.

---

## Why do my computer’s fans kick in when I re-visit the Chrome tab?

When the tab becomes visible again, several things happen at once:

1. **Duplicate visibility handlers** – Both `13-live-sales.js` (visibilitychange) and `14-dashboard.js` (dashboardController visibility) can run. Each can trigger a full dashboard refresh, so you can get **two** full refresh cycles (main dashboard + 6 widgets + overview chart + Kexo score, etc.) in quick succession.
2. **Heavy refresh cascade** – A single `refreshDashboard({ force: true })` already does ~10+ operations in parallel: main dashboard API, overview chart fetch, **6 widget fetches**, live online chart, Kexo score, plus layout/chart work. When the tab was in the background, the browser may have throttled timers; when you focus the tab, many of these fire together.
3. **ResizeObserver burst** – Focusing the tab often causes resize events. The dashboard’s **overview mini ResizeObserver** then runs `scheduleOverviewMiniResizeRender` → after debounce → **rerenderOverviewCardsFromCache**, which re-renders **all 4 overview ApexCharts**. That’s a lot of chart work in one go.
4. **Intervals still ticking** – Some intervals (e.g. “X ago” every 10s, time-on-site every 30s, server time every 1s) are only gated by `document.visibilityState === 'visible'` inside the callback; they keep **scheduling** while hidden. When you come back, several ticks can fire close together, adding more work on top of the visibility refresh.

So: **double refresh + 10+ requests + 4 chart re-renders + layout + interval ticks** when you return to the tab → CPU spike → fans.

---

## Why does the app appear sluggish?

- **Same burst on tab focus** as above: too much work (network + DOM + charts) in a short window when the tab becomes visible.
- **Chart destroy/recreate** instead of `updateOptions()` in several places (dashboard overview cards, some KPI charts). Destroy/create is heavier than update and increases GC and layout cost.
- **ResizeObserver** triggering full chart re-renders even when the quantised size hasn’t meaningfully changed (e.g. 16px bucket unchanged), so redundant work runs.
- **No visibility-based throttle for very short hides** – Returning after a few seconds still triggers a full refresh in some paths; a short hide (< 30s) could skip or reduce the refresh.
- **Sluggishness can also be perceived** when many timers/listeners/observers are left attached (see leaks below), so the main thread has more callbacks and bookkeeping even when “idle.”

---

## 10 memory / leak issues

### 1. **`kexo:profitRulesUpdated` listener added every time dashboard is shown (leak + duplicate handlers)**

- **Where:** `client/app/14-dashboard.js` (around 6796).
- **What:** When the dashboard tab is shown, `window.addEventListener('kexo:profitRulesUpdated', function () { ... })` is called with an **anonymous** handler. It is **never** removed. `registerCleanup` only runs `dashController.destroy()`, which does not remove this listener.
- **Impact:** Each switch to the dashboard adds **one more** listener. Memory leak and duplicate work when profit rules are updated.
- **Fix:** Store the handler in a variable, remove the previous listener before adding (or add once and guard), or register the listener in a place that is torn down with the controller and remove it in `destroy()` / cleanup.

### 2. **Duplicate visibility-triggered refresh (two code paths)**

- **Where:** `client/app/13-live-sales.js` (visibilitychange) and `client/app/14-dashboard.js` (dashboardController visibility).
- **What:** Two separate visibility handlers can both trigger a full dashboard refresh when the tab becomes visible (see DASHBOARD_PERFORMANCE_AUDIT.md §1).
- **Impact:** Double refresh → 2× API calls and chart work when returning to the tab → CPU spike and fans.
- **Fix:** Centralise “tab became visible” handling (e.g. 13-live-sales delegates to `dashboardController.onVisibleResume` when on dashboard) or use a shared debounce/throttle so only one refresh runs.

### 3. **Variants page: document `keydown` listeners never removed**

- **Where:** `server/public/variants-page.js` (e.g. 971, 998).
- **What:** When binding the issues modal and the all-stats modal, `document.addEventListener('keydown', ...)` is used for Escape-to-close. The handlers are **anonymous** and never removed when the modals are closed or when the page is left.
- **Impact:** Document keeps 2 (or more) keydown listeners for the lifetime of the page; minor leak and unnecessary work on every keydown.
- **Fix:** Store the handler references and call `document.removeEventListener('keydown', handler)` when closing the modal or on page/context teardown.

### 4. **08-condensed-kpis: ResizeObserver never disconnected**

- **Where:** `client/app/08-condensed-kpis.js` (top-level, ~lines 4–7).
- **What:** `_condensedStripResizeObserver = new ResizeObserver(...)` is created and observes the KPI strip. There is **no** `registerCleanup` or other teardown that calls `disconnect()`.
- **Impact:** Observer and its closures stay alive for the page lifetime; if the strip is removed/replaced, the observer can still hold references.
- **Fix:** Register a cleanup that disconnects `_condensedStripResizeObserver` (e.g. via `registerCleanup` or `kexoRegisterCleanup`).

### 5. **08-condensed-kpis: `orientationchange` listener never removed**

- **Where:** `client/app/08-condensed-kpis.js` (line 1).
- **What:** `window.addEventListener('orientationchange', function() { scheduleCondensedKpiOverflowUpdate(); })` with an anonymous function; no matching `removeEventListener`.
- **Impact:** One extra listener for the life of the page; minor leak.
- **Fix:** Keep a reference to the handler and remove it in a shared cleanup, or bind once and document that it is intentionally permanent (and ensure it’s not re-added elsewhere).

### 6. **08-condensed-kpis: visibility and pageshow listeners never removed**

- **Where:** `client/app/08-condensed-kpis.js` (e.g. 3074, 3087) inside `bindOnlineCountVisibilityGate()`.
- **What:** `document.addEventListener('visibilitychange', ...)` and `window.addEventListener('pageshow', ...)` are added with **anonymous** handlers. They are never removed.
- **Impact:** If this code path runs multiple times or in a long-lived SPA, listeners accumulate; otherwise one pair of listeners per page load that never get removed.
- **Fix:** Store handler references and remove them in a cleanup, or ensure the gate is bound only once and add a single cleanup that removes both.

### 7. **Heavy refresh cascade on tab focus (no staggering)**

- **Where:** `client/app/14-dashboard.js` → `fetchDashboardData` / `refreshDashboard`.
- **What:** One `refreshDashboard({ force: true })` triggers main dashboard + overview chart + 6 widget fetches + live online chart + Kexo score + layout work **in parallel** (see DASHBOARD_PERFORMANCE_AUDIT.md §2).
- **Impact:** ~10+ concurrent requests and DOM/chart work when returning to the tab → CPU and network spike.
- **Fix:** Defer widget fetches until after main dashboard render (e.g. requestAnimationFrame or setTimeout(0)); optionally skip overview refresh if data is fresh (e.g. last fetched &lt; 2 min).

### 8. **ResizeObserver-driven chart re-renders without “size unchanged” skip**

- **Where:** `client/app/14-dashboard.js` (overview mini ResizeObserver, `scheduleOverviewMiniResizeRender` → `rerenderOverviewCardsFromCache`).
- **What:** Resize callbacks can trigger a full re-render of all 4 overview charts. There is size quantisation (e.g. 16px) but in some flows the rerender still runs when the effective size hasn’t changed, or the debounce (e.g. 300ms) is short so multiple resize events cause multiple rerenders.
- **Impact:** Unnecessary ApexCharts destroy/recreate and layout work → more CPU and GC when you resize or when the tab gains focus (resize events).
- **Fix:** Skip `rerenderOverviewCardsFromCache` when the quantised size is unchanged; consider longer debounce (500–800ms); disconnect ResizeObservers when `visibilityState === 'hidden'` and reconnect when visible (see audit §3).

### 9. **Chart destroy/recreate instead of updateOptions**

- **Where:** `client/app/14-dashboard.js` (overview cards, main dashboard charts), `client/app/08-condensed-kpis.js` (various KPI charts).
- **What:** Several paths call `chart.destroy()` then create a new ApexCharts instance instead of using `chart.updateOptions()` / `updateSeries()` when only data or size changed.
- **Impact:** Extra allocation, GC pressure, and layout cost; contributes to sluggishness and CPU spikes on refresh/resize.
- **Fix:** Prefer `updateOptions()` / `updateSeries()` where possible; destroy/recreate only when the chart type or structure actually changes.

### 10. **13-live-sales and 14-dashboard: visibility/pageshow listeners never removed (SPA navigation)**

- **Where:** `client/app/13-live-sales.js` (e.g. 107, 122) and dashboard controller in `client/app/14-dashboard.js` (visibility/pageshow/main-tab-changed).
- **What:** 13-live-sales adds `window.addEventListener('pageshow', ...)` and `document.addEventListener('visibilitychange', ...)` with anonymous handlers and does **not** remove them on cleanup. The dashboard controller **does** remove its own visibility/pageshow/main-tab listeners in `destroy()`, but that destroy is only called when switching away from the dashboard; the 13-live-sales listeners are global and never removed.
- **Impact:** For a long-lived SPA, 13-live-sales’ visibility and pageshow listeners stay for the lifetime of the page; if the same page is re-entered (e.g. bfcache), you can get duplicate behaviour. Contributes to “everything runs at once” when returning to the tab.
- **Fix:** In 13-live-sales, store the handler references and register a cleanup (e.g. with `registerCleanup`) that removes both `pageshow` and `visibilitychange` listeners.

---

## Summary

- **Fans on tab revisit:** Double visibility refresh + ~10+ parallel requests + 4 overview chart re-renders + layout + interval ticks when the tab becomes visible.
- **Sluggishness:** Same burst of work, plus chart destroy/recreate instead of update, ResizeObserver-driven rerenders without strict “size unchanged” skip, and extra listeners/observers left attached.
- **Memory/leaks:** Repeated addition of `kexo:profitRulesUpdated` and document keydown (variants) listeners; ResizeObserver and orientation/visibility/pageshow in 08-condensed-kpis and 13-live-sales never removed; heavy parallel refresh and chart re-renders amplify CPU when returning to the tab.

Addressing the **priority fixes** in DASHBOARD_PERFORMANCE_AUDIT.md (throttle visibility refresh, deduplicate visibility handlers, pause ResizeObservers when hidden, defer widget fetches, stricter resize debounce, gate intervals on visibility) together with the **listener/observer cleanups** above will reduce leaks, duplicate work, and the tab-revisit CPU spike.
