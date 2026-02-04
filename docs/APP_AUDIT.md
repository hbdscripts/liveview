# App audit (bugs and fixes)

Audit date: 2025-02-04. Updated: 2025-02-04 (full audit: dead code, cleanup optimization, a11y, docs).

## Full audit (2025-02-04) – fixes applied

### Server

- **index.js:** Removed redundant `configStatusRouter` alias; route now uses `configStatus` directly.
- **dashboardAuth.js:** Simplified `pathname === '/' && pathname.length === 1` to `pathname === '/'`.
- **cleanup.js:** Event pruning now uses one DELETE per session (subquery with `ORDER BY ts DESC LIMIT ?`) instead of SELECT + DELETE, cutting DB round-trips in half for that step.

### Dashboard (live-visitors.html)

- **Dead CSS removed:** `.dashboard-top-bar-center`, `.dashboard-top-bar-center .top-bar-logo`, `.dashboard-top-bar-right`, and the 768px rule that hid `.dashboard-top-bar-center` (logo/top-bar controls were moved to footer).
- **Unused request removed:** Version fetch (`/api/version`) dropped; version div was removed from footer so the request had no effect.
- **Accessibility:** Added `:focus-visible` styles for refresh button, pagination buttons, config button, and audio mute button so keyboard focus is clearly visible.

### Not changed (verified OK)

- **XSS:** User/session data in innerHTML is consistently escaped via `escapeHtml()` (textContent → innerHTML pattern).
- **Config/store/db:** Typed config, parameterized queries, and store logic are sound.
- **Worker/extension:** Modern ES modules and logic; no issues found.

---

## Fixes applied (earlier sessions)

### 1. Spy mode: persistent sale

**Cause:** The Live (Spy) tab was using session filter `today` (last 24 hours). Any session that had activity in the last 24h stayed in the list, including sessions that had converted (purchased) hours ago. So an old sale kept appearing because the session was still within the "today" window.

**Fix:** Default Live session filter changed from `today` to `active` (last 5 minutes, via `ACTIVE_WINDOW_MINUTES`). Spy mode now shows only sessions with activity in the last 5 minutes, so old sales drop off. Data reporting was correct; the UX was confusing.

### 2. Table header (TH) drag-to-resize removed

All code related to dragging table headers to change column width has been removed:

- CSS: `.col-resizer`, `table[data-resizable="true"]` styles
- HTML: `data-resizable="true"` removed from all tables (sessions, country, best-sellers, worst-products, best-variants, aov)
- JS: `initResizableTables()` and its call; sessionStorage col-widths logic and resize handles

`syncSessionsTableTightMode()` is kept (used for “tight” layout when the table fits).

### 3. Migration 012 not run on app startup

**Bug:** `server/index.js` ran migrations 001–011 on startup but not 012 (`bot_block_counts`). The standalone `scripts/migrate.js` (and `npm run migrate`) did run 012. So a fresh deploy that only used `npm start` could run without the `bot_block_counts` table until the first `/api/bot-blocked` call (which has a fallback create).

**Fix:** Migration 012 is now run in the startup chain in `server/index.js` so the table always exists after boot.

---

## Other findings (no code change)

- **Cleanup:** Now uses one DELETE per session (subquery) instead of SELECT + DELETE; still one round-trip per session. For very large session counts, a single batched SQL pass could be added later if needed.
- **Ingest broadcast:** Every ingest request (including heartbeats) triggers an SSE broadcast. The dashboard only re-renders the Live table when `becamePurchased` is true, so extra broadcasts don’t cause wrong UI—just more messages. Acceptable.
- **Rate limit:** In-memory token buckets in `server/rateLimit.js` don’t persist across restarts; rate limits reset on deploy. Acceptable for current use.
- **botBlocked fallback:** `server/routes/botBlocked.js` has `ensureBotBlockCountsTable()` that creates the table if missing. With 012 now run on startup, this is redundant but harmless.

---

## Step 3 audit: Sale sound and old sales in Live

**Findings:**

1. **Sale sound only played from Stats refresh**  
   The sound was triggered only inside `renderStats()` when `conv.today > lastConvertedCountToday`. That runs when stats are fetched (Stats tab or initial load). When the user was on the **Live** tab and a sale arrived via SSE (`session_update` with `becamePurchased`), the code only called `renderTable()` and `updateKpis()` and never played the sound.

2. **Old sales still appearing from SSE**  
   The Live list uses filter `active` (5 min) for the initial fetch, but every SSE `session_update` was merged or added regardless of age. A delayed or late SSE for a purchase from hours ago would add that session to the list, so old sales could keep showing.

**Fixes applied:**

- **Sound:** When the SSE handler sets `becamePurchased`, it now plays the sale sound (if not muted) in addition to re-rendering the table and KPIs.
- **Stale sessions:**  
  - New sessions from SSE are only added if `last_seen` is within the active window (5 min).  
  - Existing sessions that receive an update but are now outside the active window are removed from the list and the table is re-rendered.

---

## Files touched (all sessions)

- `server/public/live-visitors.html` – Spy filter, TH resize removal, Live KPIs, SSE sound + active-window filter, arrived-window filter, dead CSS removal, version fetch removal, focus-visible styles
- `server/index.js` – Migration 012, configStatus alias removal
- `server/store.js` – getBounceRate, bounce in getStats, liveArrivedWindowMinutes for active filter
- `server/cleanup.js` – Event pruning: one DELETE per session (subquery)
- `server/middleware/dashboardAuth.js` – pathname check simplification
- `server/config.js` – liveArrivedWindowMinutes
- `docs/APP_AUDIT.md` – This audit
