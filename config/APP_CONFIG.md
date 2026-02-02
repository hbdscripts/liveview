# Live Visitors App – Configuration

**This project is a developer app** (Dev Dashboard, dev.shopify.com). The pixel is an app extension; you deploy it with `npm run deploy` and configure Ingest URL/Secret in the app’s extension settings. You do not add the pixel to your theme or site source code.

## Where to get Shopify credentials

1. **Developer app (Dev Dashboard)**
   - Go to your store **Admin → Apps → Develop apps** (or [Dev Dashboard](https://dev.shopify.com) if you use it).
   - Create or open your app.
   - Copy **Client ID** → `SHOPIFY_API_KEY` (or `SHOPIFY_CLIENT_ID`).
   - Copy **Client secret** → `SHOPIFY_API_SECRET` (or `SHOPIFY_CLIENT_SECRET`).

2. **App URL and redirect URLs**
   - Set **App URL** to your deployed app root (e.g. `https://your-app.example.com`).
   - Add **Allowed redirection URL(s)**:
     - `https://your-app.example.com/auth/callback`
     - `https://your-app.example.com/auth/shopify/callback`
     - `https://your-app.example.com/auth/shopify-login/callback` (for "Login with Shopify" on the dashboard splash)
   - In `.env`: `SHOPIFY_APP_URL=https://your-app.example.com`.

3. **Ingestion secret and pixel extension**
   - Run: `node scripts/generate-ingest-secret.js`
   - Copy the output and set in `.env` (and Railway): `INGEST_SECRET=<paste>`
   - The pixel is an **app extension** (not in your theme/source). There is **no** “Extensions → Configuration” screen in Dev Dashboard for the pixel. Pixel settings (Ingest URL, Ingest Secret) are set via the **GraphQL Admin API** (`webPixelCreate` / `webPixelUpdate`). After deploying with `npm run deploy`, run `node scripts/configure-pixel.js` to print the mutation, then run it in GraphiQL (e.g. when using `shopify app dev`) or use the app’s “Configure pixel” in the dashboard if available. See [docs/PIXEL_CONFIG.md](../docs/PIXEL_CONFIG.md).

## Common mistakes

- **CORS**: The ingest endpoint allows `Origin: null` and returns permissive CORS. Do not require credentials.
- **Pixel not loading**: Ensure the pixel extension has `customer_privacy` set so it can run without consent (analytics=false, marketing=false, preferences=false, sale_of_data=disabled).
- **No rows in dashboard**: Check that `INGEST_SECRET` matches in `.env` and in the pixel extension settings. Browse the storefront; the first event is usually `page_viewed`.
- **Visitor country (From column)**: Shopify’s Web Pixels API does **not** expose visitor/customer country to the pixel. We derive country on the **server** when events hit `/api/ingest`: if the request goes through **Cloudflare**, we use the `CF-IPCountry` header (no geo DB needed); otherwise we use **geoip-lite** on the client IP. So if your app/ingest URL is behind Cloudflare (e.g. custom domain proxied through CF), country comes from CF. The pixel’s browser locale is only a fallback; the server overwrites with CF or IP country when available.
- **Tracking off**: Use the admin “Tracking toggle” or set the DB setting `tracking_enabled` to `true`. Ingestion returns 204 when tracking is disabled.

## Scopes

Keep scopes minimal: `read_products`, `read_orders` (or whatever your app needs). Set in `.env` as `SHOPIFY_SCOPES=read_products,read_orders`.

## Dashboard access (optional)

Set `DASHBOARD_SECRET` in `.env` (or Railway Variables) to protect the dashboard and stats APIs on the public URL. When set:

- **Shopify admin:** Stats remain visible when opening the app from Admin (embedded app), subject to `ALLOWED_ADMIN_REFERER_PREFIX` below.
- **Direct Railway URL:** You must sign in with the same secret at `/app/login` to view the dashboard; session lasts 24 hours. Use "Sign out" in the dashboard header to clear the session.

**Password is never in source code:** The secret lives only in server env. The login form sends what you type; the server compares it. Bots cannot reverse‑engineer it from the frontend; they would have to guess (rate limiting on login is recommended if you expose it).

**Restrict to your store’s admin only:** Set `ALLOWED_ADMIN_REFERER_PREFIX` to your store’s admin URL, e.g. `https://admin.shopify.com/store/943925-c1`. Then the dashboard is allowed without password only when the request Referer or Origin (when embedded) is that URL or Shopify admin. Any other admin or direct visit must use the dashboard secret. Leave empty to allow any `admin.shopify.com` or `*.myshopify.com/admin`. To avoid getting stuck on blue “Accept” or login screens when opening the app from Shopify admin, the app allows access when the request comes from Shopify admin (Referer or Origin). The Live Visitors pixel is configured to run without requiring visitor consent (no cookie banner needed for the pixel to load).

**Login with Google / Login with Shopify:** When the referer is not your store admin URL, the splash shows Sign in with Google (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, optionally ALLOWED_GOOGLE_EMAILS; add redirect .../auth/google/callback in Google Cloud Console), Sign in with Shopify (set ALLOWED_SHOP_DOMAIN, add .../auth/shopify-login/callback in Shopify app), and Sign in with secret if DASHBOARD_SECRET is set. Why the app was not loading inside Shopify: it opens in an iframe; the server used to 302 to OAuth so the iframe tried to load OAuth inside the frame; Shopify blocks embedding so the browser showed "refused to connect." The fix is to return HTML that sets window.top.location.href to the auth URL so the whole tab goes to OAuth; after auth the app loads in the iframe. “Login with Shopify,”
## Database on Railway

Data does not persist if you leave the page or redeploy unless you use a **persistent database**. With `DB_URL` empty, the app uses SQLite and writes to a file in the app directory; on Railway that directory is ephemeral, so the file is wiped on each deploy or restart.

**To keep data (sessions, stats, settings):**

1. In your Railway project, click **+ New** and add **PostgreSQL** (or use an existing Postgres service).
2. Open the Postgres service → **Variables** or **Connect** and copy the **`DATABASE_URL`** (or construct it from `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`).
3. In the **service that runs your app** (the one deployed from GitHub), go to **Variables** and add:
   - **Name:** `DB_URL`
   - **Value:** the Postgres connection string (e.g. `postgresql://user:password@host:port/railway`)
4. Redeploy the app. On startup the app will run migrations and use Postgres; data will persist across restarts and deploys.

If you use another host (e.g. Fly.io, Heroku), add a Postgres add-on and set `DB_URL` the same way.

## Session / cleanup

The cleanup job deletes sessions older than `SESSION_TTL_MINUTES` (default **1440** = 24 hours). So by default, sessions are kept for 24 hours and the **"Today (24h)"** tab at the top shows all of them. Other tabs: **Active (5 min)**, **Recent (15 min)**, **Abandoned (24h)**, **All (60 min)**. If you set `SESSION_TTL_MINUTES` lower (e.g. 60), cleanup purges sooner and "Today (24h)" will only show whatever remains in the DB.

### Where to set or unset SESSION_TTL_MINUTES in Railway

1. Open **[Railway](https://railway.app)** and sign in.
2. Open your **project** (the one that runs the Live Visitors app).
3. Click the **service** that runs the backend (the one with the deploy from GitHub, not a database-only service).
4. Go to the **Variables** tab (or **Settings → Variables**).
5. Find **SESSION_TTL_MINUTES** in the list:
   - **To use the default (24h = 1440 min):** If it’s there, **remove it** (trash/delete the variable). Leave it unset so the app keeps sessions for 24 hours.
   - **To keep 24h:** Unset it, or set name `SESSION_TTL_MINUTES`, value `1440`.
   - **To keep sessions shorter:** Set e.g. `60` for 1 hour; "Today (24h)" will then only show sessions that haven’t been purged yet.
6. Save. Railway will redeploy when you change variables (or trigger a redeploy from the Deployments tab).

## Sentry (optional)

Set `SENTRY_DSN` in `.env` (or Railway Variables) to send server errors to Sentry. Leave empty to disable. See [docs/SENTRY_SETUP.md](../docs/SENTRY_SETUP.md) for full walkthrough. In this project, Cursor agents have access to Sentry; when asked to "check Sentry" or "look at errors", use that access to query issues and fix causes.
