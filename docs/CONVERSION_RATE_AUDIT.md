# Liveview (Live Visitors) – Conversion rate audit

**Goal:** Determine why in-app conversion rate is massively higher than Shopify’s. Read-only audit; no code changes.

---

## 1. Short summary: most likely cause(s) and confidence

| Cause | Confidence | Notes |
|-------|------------|--------|
| **Sessions undercounted (denominator too small)** | **High** | Cleanup deletes sessions by `last_seen` (default 24h). For “yesterday” / “3d” / “7d”, sessions that *started* in that window but had no activity after 24h are **deleted**. So we only count sessions that still exist → many one-visit / early-exit sessions are missing → denominator shrinks → CR inflates. |
| **No order-level dedupe (same order → multiple sessions)** | **Medium** | No `order_id` / `checkout_token` stored. Thank-you page in two tabs (two `session_id`s) = two sessions with `has_purchased=1` for one order. No bot/UA filtering. |
| **Date windowing / timezone** | **Low** | “Today” uses `ADMIN_TIMEZONE` (Europe/London) calendar day; logic is consistent. Possible mismatch if Shopify uses UTC or different TZ; not the main driver. |
| **checkout_started vs checkout_completed** | **None** | Purchase is set **only** by `payload.checkout_completed`; `checkout_started` does not set `has_purchased`. |

**Verdict:** The main driver of inflated app CR is **session undercount from cleanup**: we delete by `last_seen`, so for past-day ranges we only have sessions that had activity in the last 24h (or are abandoned in retention). One-and-done sessions that started in the window are gone → denominator too small → CR too high. Secondary risk: same order attributed to multiple sessions (no order_id dedupe).

---

## 2. Proof (file paths + minimal quoted snippets)

### 2.1 Sessions undercounted (cleanup deletes by last_seen)

**server/cleanup.js** – sessions are deleted by `last_seen`, not by `started_at`:

```js
// Delete sessions: last_seen older than SESSION_TTL_MINUTES, unless is_abandoned and abandoned_at within retention
await db.run(`
  DELETE FROM sessions
  WHERE last_seen < ?
  AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < ?)
`, [sessionCutoff, abandonedCutoff]);
```

- `sessionCutoff = now - config.sessionTtlMinutes * 60 * 1000` (default 24h).
- So any session with `last_seen` &lt; 24h ago is removed (except abandoned within retention).
- **Stats** count “sessions that **started** in [start, end)” (e.g. “today” = midnight–now in `ADMIN_TIMEZONE`).

**server/store.js** – conversion rate uses `started_at`:

```js
// getConversionRate(start, end):
const total = await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2', [start, end]);
const purchased = await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2 AND has_purchased = 1', [start, end]);
```

So for “yesterday” we count sessions where `started_at` ∈ [yesterday_start, yesterday_end), but those sessions **only exist** if they weren’t deleted. Sessions that started yesterday and had `last_seen` &gt; 24h ago are already deleted → undercount of total sessions → inflated CR.

### 2.2 No order_id / checkout_token → no dedupe of purchases

**server/store.js** – WHITELIST and schema:

- WHITELIST does **not** include `order_id`, `checkout_token`, or `checkout_id`.
- `sessions` table has no column for order/checkout identifier (only `order_total`, `order_currency`, `has_purchased`, `purchased_at`).
- **events** table (001_initial.js, 003, 004): no `order_id` / `checkout_token` column; no unique constraint on “one purchase per order”.

So we cannot:
- Reject duplicate `checkout_completed` for the same order.
- Attribute one order to one session when thank-you is opened in multiple tabs (each tab can have a different `session_id` from sessionStorage).

**extensions/live-visitors-pixel/src/index.js** – checkout_completed payload:

- Sends only `checkout_completed: true`, `order_total`, `order_currency`. No order ID or token.

### 2.3 Purchase is only set by checkout_completed (not checkout_started)

**server/store.js** – upsertSession:

```js
const hasPurchased = existing?.has_purchased || (payload.checkout_completed ? 1 : 0) || 0;
```

- `checkout_started` sets `is_checking_out` and `checkout_started_at`; it does **not** set `has_purchased`.
- So “checkout completed” matching is correct: only `checkout_completed` marks a purchase.

### 2.4 No bot / user-agent / designMode filtering

- **server/routes/ingest.js**: no User-Agent check, no bot list, no `designMode` or similar.
- **extensions/live-visitors-pixel/src/index.js**: no ignore list; every subscription sends to ingest (no dedupe by event_id/nonce).

So all events (including from bots if the pixel runs) are counted. If Shopify excludes bots, our denominator could be larger (lower CR) or we could count bot “purchases” (higher CR) – depends on Shopify’s definition; no evidence in code of bot filtering either way.

### 2.5 Session / visitor ID and “Online” logic

- **Pixel:** `visitor_id` = localStorage (persists ~30 days); `session_id` = sessionStorage (new tab = new session). No TTL in the pixel; session never “expires” client-side.
- **Dashboard “Online: X”** (server/public/live-visitors.html): `sessions.filter(s => s.last_seen >= Date.now() - 5 * 60 * 1000).length` → “sessions with activity in last 5 minutes”. This is **not** the same as Shopify’s session (which is typically 30-min inactivity or similar). Not used in CR calculation; CR is server-side from `getStats()`.

---

## 3. Numeric sanity check (DB queries)

Assumptions: `ADMIN_TIMEZONE` = Europe/London (default). “Today” = from start of today in that TZ to now. Below: SQLite-style `?`; for Postgres replace `?` with `$1,$2,...` and duplicate params where needed.

**3.1 Time bounds for “today” (use in app or run in Node with same config)**

- Start of “today” in Europe/London and “now” in ms are computed in `store.js` via `getRangeBounds('today', nowMs, timeZone)`. For ad-hoc SQL you can approximate “today” as:
  - SQLite: `strftime('%s', 'now', 'start of day')*1000` is UTC; for London you need to apply offset (e.g. winter UTC+0, summer UTC+1).
  - Or run once in app: log `getRangeBounds('today', Date.now(), resolveAdminTimeZone())` and plug `start`/`end` into the queries.

**3.2 Sessions today (started_at in window)**

```sql
-- Replace ? with start_ms, end_ms for "today" (from getRangeBounds)
SELECT COUNT(*) AS sessions_started_today
FROM sessions
WHERE started_at >= ? AND started_at < ?;
```

**3.3 Purchased sessions today (started in window and has_purchased)**

```sql
SELECT COUNT(*) AS purchased_sessions_today
FROM sessions
WHERE started_at >= ? AND started_at < ?
  AND has_purchased = 1;
```

**3.4 checkout_completed events today**

Events table uses `ts` (epoch ms). Use same “today” window (start_ms, end_ms):

```sql
SELECT COUNT(*) AS checkout_completed_events_today
FROM events
WHERE type = 'checkout_completed'
  AND ts >= ? AND ts < ?;
```

**3.5 Distinct order IDs / checkout tokens**

- **Not available.** Schema and ingest do not store `order_id`, `checkout_token`, or `checkout_id`. So you cannot run “distinct order identifiers today” or “same order twice” in the current DB.

**3.6 Duplicates: same session, multiple checkout_completed events**

```sql
SELECT session_id, COUNT(*) AS n
FROM events
WHERE type = 'checkout_completed'
  AND ts >= ? AND ts < ?
GROUP BY session_id
HAVING COUNT(*) > 1;
```

If this returns rows, the same session has multiple checkout_completed events (e.g. thank-you refreshed). That does not double-count **sessions** (has_purchased is 1 per session) but can indicate duplicate events per order.

**3.7 Window mismatch (UTC vs admin TZ)**

- Stats use `getRangeBounds(rangeKey, nowMs, timeZone)` with `timeZone = config.adminTimezone` (Europe/London). So “today” is calendar day in London, not UTC.
- If you compare to Shopify “today”, ensure you know whether Shopify uses store TZ, UTC, or something else; the app is consistent with `ADMIN_TIMEZONE` only.

---

## 4. Proposed fix plan (no code yet)

1. **Cleanup vs stats (main fix)**  
   - **Option A:** Do **not** delete sessions that started in any “stats window” we care about. For example: only delete sessions where `last_seen` is older than the **oldest** range we report (e.g. 7d), or where `started_at` and `last_seen` are both before that cutoff.  
   - **Option B:** Keep cleanup as-is but change **stats** to use a “sessions that ever existed in this window” notion (e.g. archive sessions to a `sessions_archive` table before delete, and count from archive for past ranges).  
   - **Option C:** Extend retention for “conversion” reporting: e.g. keep sessions for 7 days regardless of `last_seen` for the purpose of “sessions started in last 7d” count, and run a separate job to delete only beyond 7d.  
   - Recommended: **Option A or C** so that “sessions started in [window]” is not biased by cleanup.

2. **Order-level dedupe**  
   - Capture a stable **order identifier** from the pixel (e.g. from `event.data.checkout` if Shopify exposes order id / token).  
   - Add column(s) to `sessions` (e.g. `order_id` or `checkout_token`) and/or to `events` for `checkout_completed`.  
   - On ingest: if this order_id already exists for another session (or same session), do not increment “purchased” again (e.g. ignore duplicate checkout_completed for same order_id).  
   - Ensures one order = at most one “purchase” in CR.

3. **Duplicate checkout_completed per session**  
   - Even without order_id: if the same session sends multiple `checkout_completed` events, we already set `has_purchased = 1` once. So no change needed for session-level CR.  
   - If we add order_id, we can optionally skip inserting duplicate checkout_completed events for the same order_id.

4. **Bot / human-only (for your next step)**  
   - You mentioned Cloudflare-enriched human-only analytics. That would be a new filter at ingest (e.g. only count requests that pass a “human” or “non-bot” signal from CF). That affects both numerator and denominator and can align with Shopify if they also filter bots.

5. **Documentation / ops**  
   - Document that “today” and other ranges use `ADMIN_TIMEZONE` (default Europe/London).  
   - If migration 007 (first_path) is not run on startup, ensure it runs (e.g. add up007 to server startup or document that `npm run migrate` must be run).

---

## 5. What was inspected (for your reference)

### A) Pixel (Web Pixel extension) – event + ID logic

**File:** `extensions/live-visitors-pixel/src/index.js`

- **Subscriptions:**  
  - `analytics.subscribe('page_viewed', ...)` (lines 234–241)  
  - `analytics.subscribe('product_viewed', ...)` (244–256)  
  - `analytics.subscribe('product_added_to_cart', ...)` (258–268)  
  - `analytics.subscribe('product_removed_from_cart', ...)` (270–281)  
  - `analytics.subscribe('cart_viewed', ...)` (283–293)  
  - `analytics.subscribe('checkout_started', ...)` (295–300)  
  - `analytics.subscribe('checkout_completed', ...)` (302–321)

- **Heartbeat:**  
  - `startHeartbeat()` (206–214): `setInterval(..., HEARTBEAT_MS)` (30_000 ms), sends `payload('heartbeat')`.

- **IDs:**  
  - `visitor_id`: from `browser.localStorage.getItem(VISITOR_KEY)`; if missing or expired (> 30 days), new UUID; stored with `setVisitorId(id, createdAt, lastSeen)`.  
  - `session_id`: from `browser.sessionStorage.getItem(SESSION_KEY)`; if missing, new UUID; stored with `setSessionId(sessionId)`.  
  - No TTL for session in pixel; new tab = new session (sessionStorage).

- **Ingest:**  
  - `send(payload)` (192–204): `fetch(ingestUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': ingestSecret }, body: JSON.stringify(payload), keepalive: true })`.  
  - Payload shape (from `payload(eventType, extra)`): `event_type`, `visitor_id`, `session_id`, `ts`, `path`, `country_code`, `device`, `network_speed`, `cart_qty`, `cart_value`, `cart_currency`, UTM fields if set, plus `...extra`.  
  - For `checkout_completed`: extra includes `checkout_completed: true`, `order_total`, `order_currency`. No `order_id` or `checkout_token`.

- **Dedupe / ignore:**  
  - No event_id, nonce, or last_event_ts.  
  - No bot or user-agent ignore list; no designMode check.

### B) Backend ingest – validation, upsert, attribution

**File:** `server/routes/ingest.js`

- **Handler:** POST only; body parsed as JSON; `event_type` must be in `ALLOWED_TYPES`; `visitor_id` and `session_id` required; `X-Ingest-Secret` (or Bearer) must match `config.ingestSecret`; rate limit per `v:${visitorId}` and `s:${sessionId}` (token bucket, 120/min per key).  
- **Sanitisation:** `payload = store.sanitize(body)` (whitelist of keys).  
- **Country:** from request (Cloudflare `cf-ipcountry` or geoip-lite).  
- **Flow:** `upsertVisitor(payload)` → `upsertSession(payload)` → `insertEvent(sessionId, payload)` → broadcast SSE, 200.

**File:** `server/store.js`

- **Purchase:** `has_purchased = existing?.has_purchased || (payload.checkout_completed ? 1 : 0)`; `purchased_at` set when `payload.checkout_completed && !purchasedAt`.  
- **first_path:** Set only on INSERT (new session): `first_path`/`first_product_handle` = same as `last_path`/`last_product_handle` at create. UPDATE does not change first_path.  
- **No dedupe:** No unique constraint on order_id/checkout_token; no “ignore duplicate checkout_completed for same order”.

**Stats (getStats, getConversionRate, getSalesTotal, getConvertedCount):**

- **server/store.js**: `getRangeBounds(rangeKey, nowMs, timeZone)` with `timeZone = resolveAdminTimeZone()` (default Europe/London).  
- Conversion: `getConversionRate(start, end)` = count sessions with `started_at` in [start, end), and same + `has_purchased = 1`.  
- Sales / converted count: purchases in window by `purchased_at` (or `last_seen` when `purchased_at` is null).

**Cleanup:** `server/cleanup.js` – every 2 min (server/index.js). Deletes sessions where `last_seen < sessionCutoff` (24h default) and not abandoned within retention. Then trims events per session to `MAX_EVENTS_PER_SESSION`.

### C) Database schema (relevant parts)

**Sessions (001 + 003, 004, 005, 006, 007):**

- `session_id` PK, `visitor_id`, `started_at`, `last_seen`, `last_path`, `last_product_handle`, `first_path`, `first_product_handle`, `cart_qty`, `cart_value`, `cart_currency`, `order_total`, `order_currency`, `country_code`, UTM columns, `is_checking_out`, `checkout_started_at`, `has_purchased`, `purchased_at`, `is_abandoned`, `abandoned_at`, `recovered_at`.  
- No `order_id` or `checkout_token`.

**Events (001):**

- `id`, `session_id`, `ts`, `type`, `path`, `product_handle`, `qty_delta`, `cart_qty`, `checkout_state_json`, `meta_json`.  
- No unique constraint on (session_id, type, ts) or order identifier.

**Visitors (001):**

- `visitor_id` PK, `first_seen`, `last_seen`, `last_country`, `device`, `network_speed`, `is_returning`, `returning_count`.

### D) Dashboard CR display

**File:** `server/public/live-visitors.html`

- CR is **server-side only**: `GET /api/stats` returns `data.conversion` and `data.conversion.rolling`.  
- Dashboard: `renderConversion(statsCache)` sets `conversion-range`, `conversion-3h`, `conversion-6h` from `data.conversion[dateRange]` and `data.conversion.rolling`.  
- No client-side CR formula; no filter like “only sessions with cart_value > 0” for the main CR.

### E) Runtime evidence (example payload shapes – no logging added)

**Typical payload shapes (sanitised):**

- **page_viewed:** `{ event_type: 'page_viewed', visitor_id, session_id, ts, path, country_code, device, cart_qty, cart_value, cart_currency, ... }`  
- **cart_viewed:** same shape; may include updated cart_value/cart_currency.  
- **checkout_started:** `{ event_type: 'checkout_started', ..., checkout_started: true }`  
- **checkout_completed:** `{ event_type: 'checkout_completed', ..., checkout_completed: true, order_total, order_currency }`  

No order_id/checkout_token in any of these. For 1–2 example DB rows (purchased session + events), run the sessions and events queries above for a known purchased session_id.

---

## 6. Required DB queries (run and paste results)

Use the same “today” window (start_ms, end_ms) from `getRangeBounds('today', Date.now(), 'Europe/London')` (or your `ADMIN_TIMEZONE`). In Node you can do:

```js
const config = require('./server/config');
const store = require('./server/store');
// after getDb() and migrations
const tz = store.resolveAdminTimeZone?.() || config.adminTimezone || 'Europe/London';
const bounds = store.getRangeBounds?.('today', Date.now(), tz) || {};
console.log('today start', bounds.start, 'end', bounds.end);
```

Then:

1. **Sessions started today:**  
   `SELECT COUNT(*) FROM sessions WHERE started_at >= ? AND started_at < ?;`  
   → `sessions_started_today`

2. **Purchased sessions today (started in window):**  
   `SELECT COUNT(*) FROM sessions WHERE started_at >= ? AND started_at < ? AND has_purchased = 1;`  
   → `purchased_sessions_today`

3. **checkout_completed events today:**  
   `SELECT COUNT(*) FROM events WHERE type = 'checkout_completed' AND ts >= ? AND ts < ?;`  
   → `checkout_completed_events_today`

4. **Distinct order identifiers today:**  
   Not possible; no such column.

5. **Duplicate checkout_completed per session (today):**  
   `SELECT session_id, COUNT(*) AS n FROM events WHERE type = 'checkout_completed' AND ts >= ? AND ts < ? GROUP BY session_id HAVING COUNT(*) > 1;`  
   → paste any rows.

6. **Same session marked purchased multiple times:**  
   Not applicable; `has_purchased` is a single column (0/1) per session.

Once you have the numbers, you can compare:
- `purchased_sessions_today` vs `checkout_completed_events_today` (if events > sessions, multiple events per session).
- App CR = `purchased_sessions_today / sessions_started_today` vs Shopify’s “today” CR (same time window and definition of session/purchase).

---

**End of audit.** Next step: use this to implement Cloudflare-enriched human-only analytics and the proposed fixes (cleanup vs stats, order-level dedupe).
