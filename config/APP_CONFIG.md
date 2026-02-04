# Live Visitors App – Configuration

**Stack:** Developer app (Dev Dashboard / dev.shopify.com). Backend on **Railway**. Pixel is an app extension; deploy with `npm run deploy`. You do not add the pixel to your theme.

---

## Quick reference – this app’s URLs (Railway)

| Use | URL |
|-----|-----|
| App root / dashboard | `https://liveview-production.up.railway.app` |
| Login (Google) | `https://liveview-production.up.railway.app/app/login` |
| Ingest (pixel POST) | `https://liveview-production.up.railway.app/api/ingest` |
| Shopify OAuth callback | `https://liveview-production.up.railway.app/auth/callback` |
| Shopify OAuth (alt) | `https://liveview-production.up.railway.app/auth/shopify/callback` |
| Google OAuth callback | `https://liveview-production.up.railway.app/auth/google/callback` |

**Railway Variables** (service that runs the app): set `SHOPIFY_APP_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `INGEST_SECRET`, `DB_URL` (Postgres), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_COOKIE_SECRET`. See `.env.example` for the full list.

**"Today" in the dashboard** uses `ADMIN_TIMEZONE` (default `Europe/London`). Set it to match your Shopify store timezone so "Sales today" and "since midnight" align with Shopify (e.g. `ADMIN_TIMEZONE=Europe/London`).

---

## Where to get Shopify credentials

1. **Developer app (Dev Dashboard)**
   - **Admin → Apps → Develop apps** (or [Dev Dashboard](https://dev.shopify.com)).
   - Create or open your app.
   - **Client ID** → `SHOPIFY_API_KEY` in `.env` / Railway.
   - **Client secret** (click “Show”) → `SHOPIFY_API_SECRET`.

2. **App URL and redirect URLs**
   - **App URL:** `https://liveview-production.up.railway.app` (no trailing slash).
   - **Allowed redirection URL(s)** in Shopify app settings – add:
     - `https://liveview-production.up.railway.app/auth/callback`
     - `https://liveview-production.up.railway.app/auth/shopify/callback`
   - In `.env` and Railway: `SHOPIFY_APP_URL=https://liveview-production.up.railway.app`.

3. **Ingest secret and pixel**
   - Run: `node scripts/generate-ingest-secret.js` → copy output.
   - Set in `.env` and Railway: `INGEST_SECRET=<paste>`.
   - Pixel is an **app extension**; settings (Ingest URL, Ingest Secret) are set via **GraphQL Admin API** (`webPixelCreate` / `webPixelUpdate`). After `npm run deploy`, run `node scripts/configure-pixel.js` and use the mutation in GraphiQL, or use the app’s “Configure pixel” if available. See [docs/PIXEL_CONFIG.md](../docs/PIXEL_CONFIG.md).
   - **Ingest URL** in pixel config: `https://liveview-production.up.railway.app/api/ingest`.
   - **Ingest Secret:** same value as `INGEST_SECRET`.

---

## Common mistakes

- **CORS:** Ingest allows `Origin: null`; don’t require credentials.
- **Pixel not loading:** Extension must have `customer_privacy` so it runs without consent (analytics=false, marketing=false, preferences=false, sale_of_data=disabled).
- **No rows in dashboard:** `INGEST_SECRET` must match in Railway and in the pixel extension. Browse the storefront; first event is usually `page_viewed`.
- **Country (From column):** We set country on the server from `CF-IPCountry` (if behind Cloudflare) or geoip-lite on client IP. Pixel doesn’t get visitor country from Shopify.
- **Tracking:** Always on (no dashboard kill switch). To stop ingestion, disable/uninstall the Web Pixel in Shopify or change its Ingest URL/secret.

---

## Scopes

In `.env` / Railway: `SHOPIFY_SCOPES=read_products,read_orders,write_pixels,read_customer_events,read_reports` (write_pixels + read_customer_events for pixel API; read_reports for config panel “Shopify Sessions” today via ShopifyQL). Must match `shopify.app.toml` and app configuration in Partners. After adding `read_reports`, re-install or re-authorize the app so the store grants the new scope.



**Why orders/revenue work but "Shopify sessions (today)" shows —:**  
Shopify exposes **orders** (and revenue) via the **Orders API** (REST, scope `read_orders`) — the same token can call that with no extra approval. **Session counts** are not in the Orders API; they are only available via the **Reports/Analytics API** (GraphQL ShopifyQL, scope `read_reports`). Same app, same token, but a **different Shopify API** that Shopify locks down more: session/analytics data often requires **Protected Customer Data** (Level 2) approval in Partners, and Shopify can return "access denied" until that is enabled. So we can show Shopify orders and revenue (Orders API) but "Shopify sessions" depends on Reports (ShopifyQL) and may show — until `read_reports` is in the token and, if needed, Protected Customer Data is enabled in Partners.

**Audit checklist – Shopify Sessions (config panel “i”):**
1. **SHOPIFY_SCOPES** in Railway must include `read_reports` (server uses this for the OAuth authorize URL in `server/routes/auth.js`).
2. **Token** is stored in `shop_sessions` (shop, access_token, scope) on OAuth callback; the **scope** string is whatever Shopify returned when the merchant approved the app.
3. If “Shopify sessions (today)” shows **—**, the config panel now shows **Stored scopes:** so you can confirm whether `read_reports` is in the stored token. If it’s missing, the token was issued before you added the scope: **uninstall the app and reinstall from Shopify Admin** so a new token is issued.
4. If the stored token includes `read_reports` but Shopify still returns an error, the note will show “Shopify returned: …” (e.g. access denied; ShopifyQL may require Protected Customer Data access in Partners).

---

## Traffic and bots (Cloudflare at the edge)

- **Flow:** Storefront → Cloudflare (blocks bots) → pixel / ingest. So traffic that reaches the pixel is already “human-ish”; blocked bots never hit the ingest and never create sessions in the DB.
- **To filter all bots (Google, Bing, Merchant Center, etc.):** Set Worker env `BLOCK_KNOWN_BOTS=1` and add a Cloudflare **Request Header Transform Rule** that sets `x-lv-client-bot = 1` when `cf.client.bot eq true`. See **docs/CLOUDFLARE_INGEST_SETUP.md** for step-by-step.
- **Our data = Shopify sessions minus bots blocked at the edge.** The dashboard always uses “human” data (we no longer show All vs Human); all stats are based on sessions we recorded (i.e. traffic that reached the pixel). **Sessions and conversion rate** in the top KPI bar are always from our DB (human-only); they are never replaced by Shopify’s numbers, so when you block more bots than Shopify, our session count is lower and CR is higher. Sales and AOV for "today" may use Shopify so revenue matches Admin.
- **How many bots were blocked?** You can’t count them from our DB (they never reached us). You need **Shopify Sessions** (same time range, e.g. since midnight UK) minus **Our sessions** for that range. In the config panel (click “i”): when “Shopify Sessions” is available, we show **Bots blocked at edge (est.)** = Shopify Sessions − Sessions today. Until Shopify Sessions is wired (Shopify doesn’t expose session count via public API), that estimate shows “—” and the panel explains: “Bots blocked = Shopify Sessions − Ours (same range).”
- **Config panel (Data health):**
  - **Sessions (ours)** = sessions we recorded (last 24h). This is effectively “human” traffic that reached the pixel.
  - **Sessions today (since midnight UK)** = our count for the same range as Shopify (for comparison).
  - **Shopify Sessions (since midnight UK)** = what Shopify recorded (— until we have an API or manual feed).
  - **Bots blocked at edge (est.)** = Shopify Sessions − Sessions today when both are available.
  - **Bots (tagged in DB)** = sessions that *did* reach the pixel but were flagged as bot (e.g. by `x-lv-client-bot`). With Cloudflare blocking at the edge, this is usually 0 or low.
  - **Human (used for stats)** = sessions we use for all dashboard stats (cf_known_bot 0 or null); with edge blocking this should be close to “Sessions (ours)”.

---

## Dashboard (top bar, sale sound, date range)

- **All dashboard numbers are from our DB only.** Time range uses `ADMIN_TIMEZONE` (e.g. Europe/London) midnight-to-now for “today”. Shopify data is **not** shown in the main KPIs; it appears only in the Config panel (click “i”) so you can compare “Shopify sessions (today)” vs “Human sessions” and see “Shopify − ours (human)” (bots blocked est.).
- **Number audit (source = our API `/api/stats`, human_only):**
  - **Sales** = order count + `getSalesTotal(start, end)` — displayed as "N  £X.XX" (N = orders in range). Source: **purchases** table, fed by **checkout_completed events from our pixel** (Shopify Web Pixels API), not by Shopify pushing sale data. We never delete purchase rows (project rule: no DB deletes without backup). **Why we can over-report:** the same order can fire checkout_completed more than once (e.g. thank-you page reload, or Shopify fires once before order_id exists and once after). We dedupe **only in stats queries**: we use checkout_token/order_id when present, else session+total+currency+15min; and we exclude h: rows when a token/order row exists for the same (session, total, currency, 15min) so we don't count the same order twice. **If our count is lower than Shopify:** some orders may not have sent checkout_completed to our pixel (thank-you not loaded, or different flow).
  - **Sessions** = `trafficBreakdown[range].human_sessions` — sessions in range with `cf_known_bot` not set.
  - **Conversion rate** = `converted_count / human_sessions` in range (purchases deduped by order id).
  - **AOV** = sales / converted_count in range.
  - **Returning** = revenue from sessions marked `is_returning = 1` in range.
  - **Bounce rate** = single-page sessions (exactly one `page_viewed`) / human_sessions in range.
- **Top bar:** One date dropdown (Today, Yesterday, Last 3 Days, Last 7 Days) controls all stats; options except Today are enabled only when the backend has data for that range. Center shows "Next update in X s"; right button toggles sale sound (saved in sessionStorage as `livevisitors-sale-muted`).
- **Sale sound:** MP3 at `assets/cash-register.mp3` is served at `/assets/cash-register.mp3` and plays once when a new sale is detected (today’s converted count increases). Use "Sound on" / "Muted" to toggle; choice is stored in sessionStorage.
- **Assets (icons):** Files in `assets/` are served at `/assets/...`. To use a new file (e.g. `hicon.webp`), add it to `assets/`, commit, and push so the deploy includes it. The dashboard uses `checkout.webp` and og-thumb for landing/cart; switch to `hicon.webp` in `live-visitors.html` once the file is in the repo.

## Dashboard access (Google-only for direct visits)

- **From Shopify Admin:** Opening the app from Admin (admin.shopify.com or *.myshopify.com) is always allowed; no login.
- **Direct visit (e.g. Railway URL):** Must sign in with Google at `/app/login`. No password or secret field; session 24h; “Sign out” in header clears it.

**To enable Google sign-in (Railway / .env):**

1. **GOOGLE_CLIENT_ID** and **GOOGLE_CLIENT_SECRET**
   - [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) → Create OAuth 2.0 Client ID (Web application).
   - **Authorized redirect URI:** `https://liveview-production.up.railway.app/auth/google/callback`.
2. **OAUTH_COOKIE_SECRET**
   - Any random string. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   - Used only to sign the session cookie.
3. **ALLOWED_GOOGLE_EMAILS** (optional)
   - Comma-separated emails that can sign in. Empty = any Google account.

---

## No revenue yet?

Revenue appears when (1) data is in a **persistent DB**, and (2) the pixel sends **checkout_completed** (thank-you page).

1. **Railway:** Add **PostgreSQL** service → in the **app service** Variables set `DB_URL` to the Postgres connection string (e.g. from Postgres service → Connect → `DATABASE_URL`). Redeploy.
2. **Pixel:** Ingest URL = `https://liveview-production.up.railway.app/api/ingest`, Ingest Secret = same as `INGEST_SECRET`. Redeploy extension if needed.
3. **Test:** Place a test order and complete checkout. Check Railway logs for `POST /api/ingest` after checkout.

---

## Orders / revenue dedupe (Sales vs Shopify)

- The pixel records **checkout_completed** events in the `purchases` table.
- Shopify can emit **checkout_completed** more than once for a single order (e.g. one event before `order_id` exists, another after the order is created).
- To prevent “4 sales vs 3 orders” situations, we **dedupe purchases by `checkout_token`** when storing and when aggregating stats.

---

## Database on Railway

Without `DB_URL`, the app uses SQLite on the app’s filesystem; on Railway that is **ephemeral** (data lost on deploy/restart).

**To persist data:**

1. Railway project → **+ New** → **PostgreSQL**.
2. Postgres service → **Variables** or **Connect** → copy `DATABASE_URL` (or build from `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`).
3. **App service** (the one from GitHub) → **Variables** → add `DB_URL` = that connection string (e.g. `postgresql://postgres:xxx@xxx.railway.app:5432/railway`).
4. Redeploy. Migrations run on startup; data persists.

---

## Session / cleanup

Sessions older than `SESSION_TTL_MINUTES` are deleted (default **1440** = 24h). “Today (24h)” shows what’s left. Tabs: Active (5 min), Recent (15 min), Abandoned (24h), All (60 min).

**SESSION_TTL_MINUTES in Railway:** App service → Variables. Omit for 24h; or set e.g. `1440` for 24h, `60` for 1h. Save triggers redeploy.

---

## Sentry (optional)

Set `SENTRY_DSN` in Railway (or `.env`) from Sentry project → Settings → Client Keys (DSN). Leave empty to disable. See [docs/SENTRY_SETUP.md](../docs/SENTRY_SETUP.md). Cursor agents in this project can query Sentry when you ask to “check Sentry” or “look at errors”.
