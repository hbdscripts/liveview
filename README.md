# Live Visitors – Private Shopify App

A private (custom) Shopify app that shows a near-real-time **Live Visitors** table in Shopify admin. Uses Shopify Customer Events (Web Pixel) only; no third-party trackers. Privacy-safe (no PII), config-first, fail-open storefront.

**New to this app?** Use the **[Step-by-step install guide (INSTALL.md)](INSTALL.md)** for a full walkthrough: preparing files, creating the app in Shopify (Partners or Custom app), finding every value, deploying, configuring the pixel, installing on the store, and verifying.

## Prerequisites

- Node.js 18+
- A Shopify store (Partner app or custom app)
- (Optional) PostgreSQL if you prefer it over SQLite

## Local dev

1. Clone and install:
   ```bash
   npm install
   ```

2. Copy env and set at least the ingest secret for local testing:
   ```bash
   cp .env.example .env
   node scripts/generate-ingest-secret.js
   # Paste output into .env as INGEST_SECRET=...
   ```

3. Run migrations and start the server:
   ```bash
   npm run migrate
   npm run dev
   ```

4. Open the dashboard: [http://localhost:3000/app/live-visitors](http://localhost:3000/app/live-visitors)

5. To test ingest locally, send a POST to `http://localhost:3000/api/ingest` with header `X-Ingest-Secret: <your-secret>` and a JSON body (see pixel payload shape). The admin UI and SSE stream work without Shopify OAuth in this minimal setup.

## Create the app in Shopify

1. In [Shopify Partners](https://partners.shopify.com) (or store Admin → Apps → Develop apps), create an app.
2. Note **Client ID** and **Client secret**; set **App URL** and **Redirect URLs** to your deployed app (e.g. `https://your-app.example.com`, `https://your-app.example.com/auth/callback`, etc.).
3. Fill `.env`: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SHOPIFY_SCOPES`, `INGEST_SECRET`.
4. Update `shopify.app.toml` with your `client_id` and URLs if needed.
5. Deploy the app and install it on your store (e.g. `shopify app deploy`, then install from Partners or the store).

## Configure the pixel extension

1. In Shopify Admin → Apps → your Live Visitors app → expand the Web Pixel extension.
2. Set **Ingest URL** to `https://<your-app-url>/api/ingest`.
3. Set **Ingest Secret** to the same value as `INGEST_SECRET` in your server `.env`.
4. Deploy the extension so it runs on your storefront.

## Deploy backend

- Run the Node server behind a reverse proxy (e.g. Nginx) or on a platform (Heroku, Railway, Fly.io).
- Set all required env vars (see `.env.example`).
- Ensure the ingest endpoint is reachable from the storefront (CORS allows `Origin: null`).
- Run migrations on first deploy: `npm run migrate` (or run them at app startup; the app runs them automatically).

## Verify behaviour

1. **Browse storefront** → A row should appear in the dashboard (Active tab) after the first `page_viewed` / heartbeat.
2. **Add to cart** → Cart qty column should update.
3. **Start checkout** → “Checking out” chip appears (within the configured window).
4. **Leave with items** → After the abandoned window with no events, the session is marked “Abandoned.”
5. **Return later** → “Returning” badge and row highlight when the same visitor starts a new session.

## Privacy and disabling tracking

- The app does not collect PII (no email, phone, name, address, IP, full user agent, or full referrer).
- Only anonymous `visitor_id` and `session_id` (generated client-side) and whitelisted event fields are stored.
- To disable tracking quickly: use the **Tracking toggle** in the admin dashboard, or set the DB setting `tracking_enabled` to `false`. Ingestion then returns 204 and does not persist events.
- Coverage depends on customer privacy settings; the dashboard shows a note and an optional “Consent (debug)” column for diagnostics.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start server (development). |
| `npm run start` | Start server (production). |
| `npm run migrate` | Run DB migrations. |
| `npm run generate-ingest-secret` | Print a random secret for `INGEST_SECRET`. |
| `npm run config:link` | Run Shopify CLI: link this project to your app using `SHOPIFY_API_KEY` from `.env` (non-interactive). |
| `npm run deploy` | Run Shopify CLI: deploy app and Web Pixel extension with `--allow-updates` (non-interactive). |
| `npm run shopify:info` | Run Shopify CLI: show app and extension info. |

The project runs **Shopify CLI directly** from scripts (like theme check in another project). Set `SHOPIFY_API_KEY` in `.env`, run `shopify auth login` once, then `npm run config:link` and `npm run deploy` from this repo.

## Main files and folders

- `server/` – Config, DB, migrations, ingest, SSE, cleanup, API routes, static admin UI.
- `server/public/live-visitors.html` – Dashboard (table, tabs, side panel, KPIs, config status, tracking toggle).
- `extensions/live-visitors-pixel/` – Web Pixel extension (`shopify.extension.toml` + `src/index.js`).
- `.env.example` – All env vars with short descriptions.
- `config/APP_CONFIG.md` – Where to get credentials, URLs, ingest secret, common mistakes.

## Env vars you must set

Minimum for a working install:

- `SHOPIFY_API_KEY` (or `SHOPIFY_CLIENT_ID`)
- `SHOPIFY_API_SECRET` (or `SHOPIFY_CLIENT_SECRET`)
- `SHOPIFY_APP_URL`
- `INGEST_SECRET` (same value in pixel extension settings)

Optional: `DB_URL` (Postgres), time windows, rate limits (see `.env.example`).

## Admin route

- Dashboard: `https://<your-app-url>/app/live-visitors` (or `/` redirects there).

## Pixel ingest URL and secret

- **URL**: `https://<your-app-url>/api/ingest`
- **Secret**: Set in pixel extension settings (Ingest Secret) and in server `.env` as `INGEST_SECRET`. The pixel sends it in the `X-Ingest-Secret` header.
