# App audit (bugs and fixes)

Audit date: 2025-02-04.

## Fixes applied this session

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

- **Cleanup scalability:** `server/cleanup.js` loads all session IDs then, per session, loads event IDs to prune. With a very large number of sessions this could be slow; consider batching or a single SQL pass if it becomes an issue.
- **Ingest broadcast:** Every ingest request (including heartbeats) triggers an SSE broadcast. The dashboard only re-renders the Live table when `becamePurchased` is true, so extra broadcasts don’t cause wrong UI—just more messages. Acceptable.
- **Rate limit:** In-memory token buckets in `server/rateLimit.js` don’t persist across restarts; rate limits reset on deploy. Acceptable for current use.
- **botBlocked fallback:** `server/routes/botBlocked.js` has `ensureBotBlockCountsTable()` that creates the table if missing. With 012 now run on startup, this is redundant but harmless.

---

## Files touched

- `server/public/live-visitors.html` – Spy filter default, TH resize removal
- `server/index.js` – Migration 012 in startup chain
- `docs/APP_AUDIT.md` – This audit
