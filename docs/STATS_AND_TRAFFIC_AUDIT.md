# Stats, conversion rate, and Human/All traffic – audit

**Purpose:** Explain why conversion rate or sessions can look “stuck”, why yesterday’s sessions might be low, and why Human vs All can show the same numbers. Also how the script is set up and how to debug.

---

## 1. Conversion rate “stuck” or low

**How it’s computed**

- **Conversion rate** = `(purchases in period) / (sessions started in period)`.
- Purchases come from the **purchases** table (by `purchased_at` in the period).
- Sessions come from the **sessions** table (by `started_at` in the period).
- Periods use **UK midnight** (or `ADMIN_TIMEZONE`): today, yesterday, 3d, 7d, month.

**Why it can look “stuck”**

1. **Browser cache** – The dashboard was reusing a cached `GET /api/stats` response. Fix: stats requests now use a cache-busting query param and `cache: 'no-store'`.
2. **Date range change didn’t refetch** – Changing the dropdown (e.g. to “Yesterday”) only re-rendered from the last response. Fix: changing the date range now triggers a new `fetchStats()` so numbers are fresh for the selected range.
3. **Low denominator** – If “sessions started” for that period is small (e.g. ingest not receiving traffic, or retention/timezone cutting the window), the rate can look wrong or frozen.

---

## 2. Sessions for “yesterday” stuck at a low number (e.g. 232)

**How it’s computed**

- **Sessions** for a range = `COUNT(*)` from `sessions` where `started_at` is in that range (UK midnight boundaries).
- **Yesterday** = from yesterday 00:00 UK to today 00:00 UK.

**Why it can be low**

1. **Ingest path** – If the pixel sends events **directly** to your app (not via the Cloudflare Worker), sessions are still stored; but if most traffic goes to a different URL or is blocked, only a subset of sessions will be in the DB.
2. **Retention** – Sessions are deleted only when **both** `last_seen` and `started_at` are older than `SESSION_RETENTION_DAYS` (default 30). So yesterday’s sessions should not be removed; if they are, check that cleanup uses the same retention and that the app’s retention config is correct.
3. **Timezone** – Ranges use `ADMIN_TIMEZONE` (default `Europe/London`). If the server or store is in another zone, set `ADMIN_TIMEZONE` in `.env` to match the store’s timezone so “yesterday” is the correct 24h window.
4. **Actual volume** – The DB might genuinely have only that many sessions for that window (e.g. pixel not on all pages, or low traffic).

**Debug**

- Run baseline queries to see raw counts, e.g.  
  `node scripts/cr-baseline-queries.js`
- Check that ingest is receiving events (logs, or a test event) and that the Worker (if used) is forwarding to the same app.
- Confirm `SESSION_RETENTION_DAYS` and that cleanup hasn’t deleted recent sessions.

---

## 3. Human vs All does nothing different

**How it works**

- **All** – Counts all sessions (no filter).
- **Human** – Excludes sessions where `cf_known_bot = 1` (i.e. only `cf_known_bot IS NULL OR cf_known_bot = 0`).

**Why Human and All can show the same**

- **`cf_known_bot` is only set when traffic goes through the Cloudflare Worker.**  
  The Worker adds `x-cf-known-bot` (and related headers). The ingest route reads these and stores them on the session. If traffic hits your app **directly** (no Worker), those headers are missing and `cf_known_bot` stays `NULL`. The “Human” filter includes `NULL`, so Human and All then count the same sessions.
- So: **for Human vs All to differ, ingest must go through the Worker** (see `docs/CLOUDFLARE_INGEST_SETUP.md`).

**UI change**

- The Sessions card now respects the toggle: **All** shows `total_sessions`, **Human** shows `human_sessions`. So when the Worker is in use and some traffic is marked bot, the numbers will differ when you switch.

---

## 4. Script / API summary

| Item | Location | Behaviour |
|------|----------|-----------|
| Stats API | `GET /api/stats` | Query param `?traffic=human` → human-only counts. Default uses `TRAFFIC_MODE` env. |
| Ranges | `server/store.js` | UK midnight via `ADMIN_TIMEZONE`. Keys: today, yesterday, 3d, 7d, month. |
| Conversion | `store.getConversionRate` | Sessions (with optional traffic filter) in range; purchases in range from `purchases` table. |
| Sessions count | `store.getSessionCounts` | Returns `total_sessions` and `human_sessions` per range in `trafficBreakdown`. |
| Dashboard | `live-visitors.html` | Date dropdown drives `dateRange`; traffic toggle drives `trafficMode`. Both trigger refetch; stats URL is cache-busted. |

---

## 5. Checklist if numbers look wrong

- [ ] Ingest URL: is the pixel sending to the Worker URL (so `cf_known_bot` is set) or directly to the app?
- [ ] `ADMIN_TIMEZONE`: matches the store’s timezone for “yesterday” / “today”?
- [ ] `SESSION_RETENTION_DAYS`: default 30; cleanup only deletes when both `last_seen` and `started_at` are older than this.
- [ ] Run `node scripts/cr-baseline-queries.js` and compare session/purchase counts to what you expect.
- [ ] Hard refresh or clear cache when testing stats; the app now sends cache-busting and `cache: 'no-store'` for stats.
