# Live Visitors / HBD Analytics – Full Breakdown for AI

This document describes what the tracker is, how it works, what it does with Shopify, what it tracks, its weaknesses, and known bugs—in a form optimized for AI (agents, future developers, LLMs) to reason about the codebase.

---

## 1. What this tracker is

- **Names:** Live Visitors, HBD Analytics (same app).
- **Purpose:** Near–real-time analytics for a Shopify store: sessions, events, cart, checkout, sales, conversion rate, returning customers, bounce rate, country breakdown, best/worst products. Goal: accurate, human-only data (no bots) so conversion rate and sessions reflect real traffic; compare with Shopify’s numbers via config panel.
- **Stack:** Node server (Railway), PostgreSQL or SQLite, Shopify Web Pixel extension (storefront), optional Cloudflare Worker in front of ingest. Dashboard: single HTML page (`server/public/live-visitors.html`), server-sent events (SSE) for live updates. No Shopify “push” of sales; sales come only from pixel `checkout_completed` events.

---

## 2. Architecture (high level)

- **Storefront** → Shopify loads the **Web Pixel** extension (`extensions/live-visitors-pixel/`). Pixel generates `visitor_id` (localStorage) and `session_id` (sessionStorage), and sends events to **ingest**.
- **Ingest** → `POST /api/ingest` (server `server/routes/ingest.js`). Optional: request hits **Cloudflare Worker** (`workers/ingest-enrich.js`) first; Worker can block known bots and add CF headers, then forwards to server. Server validates `X-Ingest-Secret`, rate-limits, derives country (CF-IPCountry or geoip), then calls **store** (upsert visitor, upsert session, append event, and on `checkout_completed` insert purchase). Server broadcasts to SSE for live dashboard.
- **Store** → `server/store.js`. All persistence: visitors, sessions, events, settings, purchases. Timestamps in epoch ms. **No deletes** of purchase/session/event rows in normal operation (project rule: no DB deletes without backup); deduplication is query-side only for purchases.
- **Dashboard** → `server/public/live-visitors.html`. Tabs: **Home** (sessions table: Live | Last Hour | Today by default; plus date dropdown for Yesterday, 3d, 7d) and **Breakdown** (stats, country, best/worst products). KPIs: Sales (order count + revenue), Sessions, Conv rate, Returning, AOV, Bounce rate. Config panel (click “i”): DB health, ingest URL, today’s sessions vs Shopify sessions, bot counts. **KPI boxes are currently forced to N/A** (see Known bugs) until sales/revenue dedupe is trusted.

---

## 3. Data flow (tracking)

1. **Visitor/Session IDs:** Client-only. Pixel uses `browser.localStorage` (visitor_id, 30-day TTL) and `browser.sessionStorage` (session_id). No PII; no IP stored.
2. **Events:** Pixel sends: `page_viewed`, `product_viewed`, `cart_*`, `checkout_started`, `checkout_completed`, `heartbeat`. Each event POSTs to `/api/ingest` with whitelisted fields (path, cart_qty, order_total, etc.). Server upserts visitor (last_seen, country, device), upserts session (last_seen, last_path, cart, checkout state, etc.), appends to `events` table. **Heartbeat** every 30s (`HEARTBEAT_MS` in pixel); each heartbeat updates `last_seen`—so an open tab keeps a session “alive” for hours.
3. **Purchases/Sales:** **Only** when the pixel sends `checkout_completed` (thank-you page). Shopify does **not** push sales to this app. Server computes a `purchase_key`: if `checkout_token` → `token:<token>`; else if `order_id` → `order:<id>`; else `h:<hash(session, total, currency, 15min)>`. Row inserted with `ON CONFLICT (purchase_key) DO NOTHING`. We **never delete** purchase rows; over-counting is handled in **stats queries** by excluding duplicate `h:` rows when a `token:` or `order:` row exists for same session+total+currency+15min (`purchaseFilterExcludeDuplicateH` in store.js).
4. **Returning:** Visitor is “returning” if time since previous visit > `returningGapMinutes`. Set at session start and stored on session (`is_returning`). **Returning** KPI = revenue from sessions where `is_returning = 1` in range. If Returning shows £0 or — for past ranges, check that sessions have `is_returning` backfilled (migration 013, 015) and that range bounds use `purchased_at`/session start correctly.
5. **Bots:** (1) **Edge:** Cloudflare Worker can block requests with `BLOCK_KNOWN_BOTS=1` and header `x-lv-client-bot` (set by CF Transform Rule from `cf.client.bot`). Blocked requests never reach server → no session. (2) **Tagged:** Requests that reach the app can have `x-cf-known-bot` etc.; stored in session (`cf_known_bot`, `cf_verified_bot_category`). Dashboard stats use “human” only (exclude `cf_known_bot = 1`). **Sessions (total)** in config = all sessions today; **Human sessions** = non-bot; **Bot ingest calls blocked at edge** = count from Worker callback `POST /api/bot-blocked` (optional).

---

## 4. What this app does with Shopify

- **OAuth:** App is a Shopify app. Merchant installs → OAuth → server stores `access_token` and `scope` in `shop_sessions`. Used for: opening dashboard from Admin (no login), and for calling Shopify APIs.
- **Orders API (REST):** Used for: **Shopify sales/orders today** (e.g. `/api/shopify-sales`), **Best Sellers**, **Best Variants**. Scope: `read_orders`. Same token works here; no extra approval.
- **Reports/Analytics API (ShopifyQL):** Used **only** for **Shopify sessions (today)** in config panel. Query: `FROM sessions SHOW sessions DURING today` via GraphQL `shopifyqlQuery`. Scope: `read_reports`. **Different API** from Orders; Shopify often requires “Protected Customer Data” (Level 2) in Partners and can return “access denied” even with `read_reports`. So: **Orders/revenue from Shopify = Works.** **Shopify sessions count = Often — (dash) or error** until token has `read_reports` and Partners has Protected Customer Data enabled.
- **Web Pixels API:** Shopify runs the pixel on the storefront and emits events (e.g. `checkout_completed` on thank-you page). We do **not** receive sale data by webhook or server-to-server; all sales in our DB come from the pixel.

---

## 5. Dashboard behaviour (important for AI)

- **Home tab:** Table of sessions. Tabs above table: **Today | Last Hour | Live**. Default load: **Today** (sessions that **started** today, per `ADMIN_TIMEZONE` midnight). **Last Hour** = sessions with **activity** (`last_seen`) in last 60 minutes. **Live** = sessions with `last_seen` in last 10 minutes and `started_at` in last 60 minutes. Date dropdown (Today, Yesterday, 3d, 7d) controls **stats range** for KPIs and which sessions are fetched for the table when not Live/Last Hour.
- **Breakdown tab:** Stats by range (today, yesterday, 3d, 7d), country table, best sellers, worst products, best variants. All from **our DB** (and optionally Shopify Orders API for best sellers/variants when scope allows).
- **Online count:** “Online: N” = sessions with `last_seen` and `started_at` within active/arrived windows. Should be shown **regardless of date range** (real people online now). If it shows — when not on Live, that’s a bug (front-end only shows it on Live unless fixed).
- **Next update:** Circular progress (green #0d9488) that fills until next refresh; Live = 60s, Today/Last Hour = 10 min.
- **KPI boxes:** Currently **all show N/A** (Sales, Sessions, Conv rate, Returning, AOV, Bounce rate). Comment in `renderLiveKpis` explains: sales/revenue dedupe and pixel-vs-Shopify alignment not final; to restore real values, remove the N/A block and uncomment the “Real values (when fixed)” block.

---

## 6. Weaknesses and why numbers can be wrong

- **Sales over-reporting:** Same order can fire `checkout_completed` multiple times (thank-you reload, or Shopify fires once before `order_id` and once after). We dedupe by `purchase_key` (token > order_id > h:) and in queries exclude duplicate `h:` when token/order row exists. If dedupe is too strict → under-report; too loose → over-report. **No raw data is deleted**; fixing logic only changes how we **count** in queries.
- **Sales under-reporting:** Some orders never send `checkout_completed` to our pixel (thank-you not loaded, ad-blocker, different flow). We cannot “recover” those except by using Shopify Orders API as source of truth for revenue (we already have routes for that; dashboard can show our count + Shopify revenue for comparison).
- **Sessions vs Shopify:** Our “Sessions” = sessions we recorded (pixel reached). If we block bots at edge, our count can be **lower** than Shopify’s; if we don’t, we can be **higher**. “Shopify sessions (today)” in config often shows — because Reports API (ShopifyQL) is locked down.
- **Returning:** Depends on `is_returning` and session–purchase join. If backfill missed sessions or range uses wrong time window, Returning can be £0 or — for yesterday/3d/7d.
- **Bots in “total”:** Config shows “Sessions (total)” and “Human sessions”. “Total” does **not** subtract “Bot ingest calls blocked at edge” (those requests never reached us). So total = what we stored; human = total minus tagged bots. Edge-blocked count is separate.

---

## 7. Known bugs and issues (user-reported)

- **Sales over-reporting then under-reporting:** App showed more sales/revenue than Shopify; after dedupe changes, showed less (e.g. 9 sales £690 vs Shopify 15 orders £973). Data is **not** deleted; under-count is from query-side dedupe being too aggressive or missing rows (e.g. token/order not always present). KPIs temporarily forced to N/A until logic is trusted.
- **Shopify sessions (today) always —:** Even with `read_reports` in Railway and Shopify and app reinstalled. Reason: session count comes from **Reports/ShopifyQL API**, not Orders API; Shopify often requires Protected Customer Data and returns access denied. Stored scopes may still show `read_reports` missing if token was issued before scope was added.
- **Shopify Best Sellers / Best Variants 502:** Requests to `/api/shopify-best-sellers` and `/api/shopify-best-variants` return 502. Usually: token missing `read_orders` or Shopify returning 403/access denied (e.g. Protected Customer Data). User confirmed scopes in Dev Dashboard and re-authorized; may need Partners app approval or different store/app configuration.
- **Online shows — unless on Live:** Online count (real people online) should be independent of date range; it was only populated when viewing Live tab. Logic may gate on `dateRange === 'live'` in the front-end.
- **Returning empty for yesterday:** Returning revenue shows for today but not yesterday despite 5 returning customers. Likely: range filter or `is_returning`/backfill for that range.
- **Live in date dropdown:** User asked to remove “Live” from the main date dropdown since Live is now a tab above the table; if it still appears, front-end still includes it in dropdown options.
- **Order count vs amount label:** User wanted “17 Sales” then “£1188.58” (number before “Sales”, not before amount). Implemented as “N Sales” label and revenue in value; if “17 £1188.58” appears with 17 before amount, label/value order is wrong in markup.
- **Last Hour showed too few rows:** “Last Hour” filtered by `started_at` in last hour (sessions that **started** in last 60 min). Fixed to filter by `last_seen` in last hour (sessions **active** in last 60 min) so it matches “today” rows that fall in the last hour.

---

## 8. Key files and rules for AI

- **No deletes:** `.cursor/rules/no-delete-without-backup.mdc` — never delete from purchases/sessions/events without backup; dedupe in queries only. See `server/store.js` (`insertPurchase`, `purchaseFilterExcludeDuplicateH`, `getSalesTotal`, `getConvertedCount`, `getReturningRevenue`, `getCountryStats`).
- **Sales source:** Revenue and order count in dashboard come from **purchases** table, filled by **pixel `checkout_completed`** only. Not from Shopify webhooks or server push. Over-report = duplicate events; under-report = dedupe too aggressive or missing events.
- **Config:** `config/APP_CONFIG.md` — credentials, scopes, Shopify Sessions vs Orders API, bots, dashboard behaviour. `.env.example` — env vars.
- **Ingest:** `server/routes/ingest.js` — validate, rate-limit, country, CF context, store.upsertVisitor, store.upsertSession, store.appendEvent, store.insertPurchase (on checkout_completed), SSE broadcast.
- **Store:** `server/store.js` — all DB access, range bounds (`getRangeBounds`), purchase dedupe filter, stats (getSalesTotal, getConvertedCount, getReturningRevenue, trafficBreakdown, etc.).
- **Dashboard:** `server/public/live-visitors.html` — single file; `renderLiveKpis` has N/A override and commented “Real values” block; tabs Today | Last Hour | Live; date range; Online; next-update circle.
- **Pixel:** `extensions/live-visitors-pixel/src/index.js` — events, heartbeat 30s, visitor/session IDs, ingest URL/secret.
- **Worker:** `workers/ingest-enrich.js` — optional; block bots, add CF headers, forward to origin.

Use this document to reason about behaviour, fix bugs, or add features without contradicting the architecture or the no-delete rule.
