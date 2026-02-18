# Configuration (env vars + runtime toggles)

**Stack:** Developer app (Dev Dashboard). Backend on Railway. Pixel is an app extension; deploy with `npm run deploy`.

---

## Quick reference — URLs (Railway)

| Use | URL |
|-----|-----|
| App root / dashboard | `https://app.kexo.io` |
| Login (Google) | `https://app.kexo.io/app/login` |
| Ingest (pixel POST) | `https://app.kexo.io/api/ingest` |
| Shopify OAuth callback | `https://app.kexo.io/auth/callback` |
| Shopify OAuth (alt) | `https://app.kexo.io/auth/shopify/callback` |
| Google OAuth callback | `https://app.kexo.io/auth/google/callback` |

**Railway Variables:** set on the **service** that runs the app (not only Shared Variables). See `.env.example` for the full list. Key: `SHOPIFY_APP_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `INGEST_SECRET`, `DB_URL` (Postgres), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_COOKIE_SECRET`.

**"Today"** uses `ADMIN_TIMEZONE` (default `Europe/London`). Set to match your Shopify store timezone.

---

## Env vars (single source: server/config.js)

All runtime env is read in `server/config.js`; server code should use `config.*`, not `process.env.*` directly.

- **Shopify:** `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SHOPIFY_SCOPES`
- **Ingest:** `INGEST_SECRET`, `INGEST_PUBLIC_URL`, `ALLOWED_INGEST_ORIGINS`
- **Display:** `ADMIN_TIMEZONE`
- **Time windows:** `ACTIVE_WINDOW_MINUTES`, `LIVE_ARRIVED_WINDOW_MINUTES`, `RECENT_WINDOW_MINUTES`, `SESSION_TTL_MINUTES`, `SESSION_RETENTION_DAYS`, `ABANDONED_WINDOW_MINUTES`, `CHECKOUT_STARTED_WINDOW_MINUTES`, etc.
- **DB:** `DB_URL` (Postgres; empty = SQLite), `SQLITE_DB_PATH`, `ADS_DB_URL`
- **Sentry:** `SENTRY_DSN` (optional)
- **Deploy proof:** `GIT_SHA` (optional; full git commit SHA returned by `/api/version` as `git_sha`). In production on Railway, set this as a Variable (or rely on Railway-provided `RAILWAY_GIT_COMMIT_SHA`, which the app uses as a fallback).
- **Fraud:** `FRAUD_IP_SALT`, `FRAUD_AI_ENABLED`, `OPENAI_API_KEY`
- **Kexo Score AI:** `KEXO_AI_ENABLED`, `KEXO_AI_MODEL`
- **OAuth (direct visit):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_COOKIE_SECRET`, `ALLOWED_GOOGLE_EMAILS`
- **Shop/display:** `ALLOWED_SHOP_DOMAIN`, `SHOP_DOMAIN`, `STORE_MAIN_DOMAIN`, `SHOP_DISPLAY_DOMAIN`, `ASSETS_BASE_URL`
- **Scheduled jobs:** toggles (e.g. `DISABLE_SCHEDULED_TRUTH_SYNC`, `DISABLE_SCHEDULED_BACKUPS`, etc.) — see server startup; documented in this file when added to config.

---

## Database (Railway)

Without `DB_URL`, the app uses SQLite (ephemeral on Railway). To persist: add **PostgreSQL** service, then in the **app service** Variables set `DB_URL` to the Postgres connection string. Redeploy. Migrations run on startup.

---

## Cloudflare Worker (ingest bot blocking)

To block known bots at the edge so they never reach the app:

1. **Worker env** (Workers & Pages → your Worker → Settings → Variables):  
   `BLOCK_KNOWN_BOTS=1`; `INGEST_SECRET` = same as app (as Secret).
2. **Request Header Transform Rule** (Rules → Transform Rules):  
   When `(http.request.uri.path eq "/api/ingest" or ends_with(..., "/api/ingest")) and cf.client.bot eq true`, set header `x-lv-client-bot` = `1`.  
   Worker reads this and, when `BLOCK_KNOWN_BOTS=1`, returns 204 and does not forward to origin.
3. Redeploy Worker after changing env.

`cf.client.bot` requires Bot Management or Super Bot Fight Mode for the zone.

---

## Sentry

Set `SENTRY_DSN` in Railway or `.env` from Sentry → Settings → Client Keys (DSN). Leave empty to disable.

### Verifying capture (safe + controlled)

- **Backend**: when `SENTRY_DSN` is set, open `GET /debug-sentry` to throw a test error (server-side) and confirm it appears in Sentry.
- **Frontend**:
  - **Local dev**: run `window.__kexoDebugSentry()` in the browser console.
  - **Production/staging**: either add `?debugSentry=1` to the URL then run `window.__kexoDebugSentry()`, or set `localStorage.setItem('kexo:debug-sentry','1')` and refresh.
