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
- **Tracking off:** Use dashboard “Tracking toggle” or DB setting `tracking_enabled=true`.

---

## Scopes

In `.env` / Railway: `SHOPIFY_SCOPES=read_products,read_orders,write_pixels,read_customer_events` (write_pixels + read_customer_events needed for pixel API). Must match `shopify.app.toml` and app configuration in Partners.

---

## Dashboard (top bar, sale sound, date range)

- **Top bar:** One date dropdown (Today, Yesterday, Last 3 Days, Last 7 Days) controls all stats; options except Today are enabled only when the backend has data for that range. Center shows "Next update in X s"; right button toggles sale sound (saved in sessionStorage as `livevisitors-sale-muted`).
- **Sale sound:** MP3 at `assets/cash-register.mp3` is served at `/assets/cash-register.mp3` and plays once when a new sale is detected (today’s converted count increases). Use "Sound on" / "Muted" to toggle; choice is stored in sessionStorage.

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
