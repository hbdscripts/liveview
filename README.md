# Live Visitors – Private Shopify App

A private (custom) Shopify app that shows a near-real-time **Live Visitors** table in Shopify admin. Uses Shopify Customer Events (Web Pixel) only; no third-party trackers. Privacy-safe (no PII), config-first, fail-open storefront.

Install steps are below (clone, env, Shopify app, pixel, deploy). See [docs/CONFIG.md](docs/CONFIG.md) for env vars and runtime toggles.

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

4. Open the dashboard: [http://localhost:3000/](http://localhost:3000/) (redirects to `/dashboard/overview` after login)

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
- **Railway**: Auto-deploys from git; push to main is sufficient. Do not run `railway up` manually.
- Set all required env vars (see `.env.example`).
- **Persistent data (Railway / Fly / Heroku):** If you leave `DB_URL` empty, the app uses SQLite and writes to a file. On Railway (and similar platforms) the filesystem is **ephemeral**—data is lost on every deploy or restart. To keep sessions and stats when you leave the page or redeploy, add a **PostgreSQL** database and set `DB_URL` to its connection string. See [docs/CONFIG.md](docs/CONFIG.md) for Railway steps.
- Ensure the ingest endpoint is reachable from the storefront (CORS allows `Origin: null`).
- Run migrations on first deploy: `npm run migrate` (or run them at app startup; the app runs them automatically).

## Verify behaviour

1. **Browse storefront** → A row should appear in the dashboard (Active tab) after the first `page_viewed` / heartbeat.
2. **Add to cart** → Cart qty column should update.
3. **Start checkout** → “Checking out” chip appears (within the configured window).
4. **Leave with items** → After the abandoned window with no events, the session is marked “Abandoned.”
5. **Return later** → “Returning” badge and row highlight when the same visitor starts a new session.

## Stats calculations (important)

These rules prevent the stats from drifting or looking wrong over time:

- **Reporting sources (configurable)**: Most dashboard reporting respects settings in the DB:
  - Orders source: `reporting_orders_source = orders_shopify | pixel`
  - Sessions source: `reporting_sessions_source = sessions | shopify_sessions`
  Use **Diagnostics → Definitions** to see which tables respect which settings.
- **Orders + revenue source**: When `ordersSource=orders_shopify`, metrics come from Shopify truth (`orders_shopify`, paid). When `ordersSource=pixel`, metrics come from pixel-derived purchases (`purchases`, derived from `checkout_completed`).
- **Conversion rate** uses the selected sources: \(CR\% = \frac{\text{convertedCount}}{\text{sessionsCount}} \times 100\). Numerator respects `ordersSource`; denominator respects `sessionsSource` where supported.
- **Pixel-mode time basis**: Pixel-derived sales totals use `sessions.purchased_at` (set on `checkout_completed`) rather than `last_seen`; if `purchased_at` is null (e.g. pre-migration), `last_seen` is used so revenue still counts.
- **"Today"** means since midnight in `ADMIN_TIMEZONE` (defaults to `Europe/London`).
- **Dropdown ranges**: Today, Yesterday, 3 days, 7 days. The 3d/7d ranges start at midnight N-2 / N-6 and include today.
- **Country stats** use `sessions.country_code` captured at event time, not `visitors.last_country` (which changes later and can skew historical reports).
- **Migration `004_session_stats_fields`** backfills `sessions.country_code` and `purchased_at` for old rows and adds indexes. Older data is approximate until new purchase events arrive.

## Brand Colors

The app uses a modern gradient-based color scheme:

### Primary Colors
- **Blue 1**: `#4592e9` (Sky blue)
- **Blue 2**: `#1673b4` (Deep blue, primary accent)
- **Green 1**: `#32bdb0` (Turquoise)
- **Green 2**: `#179ea8` (Teal)
- **Orange**: `#fa9f2e` (Vibrant orange)

### Gradient
- **Main Gradient**: Horizontal blend of all brand colors (blue → green → orange)
- Used for: Footer, sale notifications, KPI sales value, and accent highlights

### Backgrounds
- **Main body**: Light pastel gradient mixing blues, greens, and warm tones
- **Table cells**: `#fafcff` (extremely light blue-tinted white)
- **Cards**: Pure white `#ffffff`

### Usage
All colors are defined as CSS variables in `server/public/app.css` at the `:root` level. The primary accent color is Blue 2 (`#1673b4`), with the gradient used for high-impact UI elements.

## Privacy

- The app does not collect PII (no email, phone, name, address, IP, full user agent, or full referrer).
- Only anonymous `visitor_id` and `session_id` (generated client-side) and whitelisted event fields are stored.
- Tracking is always on (no dashboard kill switch). To stop ingestion, disable/uninstall the Web Pixel in Shopify or change its Ingest URL/secret.
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

## UI modal overlay standard

- Default overlay for modals is dark (`.modal-backdrop` uses black background with strong opacity).
- Custom/fallback modal implementations must add an equivalent dark backdrop (click-to-close where appropriate) and support close via header X + Escape.
- If a modal needs a different overlay intensity, use a more specific modal-scoped class override (do not weaken the global default).

## Main files and folders

- `server/` – Config, DB, migrations, ingest, SSE, cleanup, API routes, static admin UI.
- `server/public/*.html` – Tabler UI pages (`dashboard`, `live`, `sales`, `date`, `countries`, `products`, `channels`, `type`, `ads`, `tools`, `settings`).
- `server/public/app.js` – Shared frontend bundle with per-page bootstraps.
- `server/public/tabler-theme.css` – Tabler theme overrides + sticky navbar overlap.
- `server/public/tools.css` – Tools page styling.
- `server/public/live-visitors.html` – Legacy monolithic dashboard (kept as backup).
- `server/trackerDefinitions.js` – Metric/table definitions manifest for Diagnostics → Definitions.
  - When you move/rename/remove a dashboard section/table/card, update this file (especially `ui.elementIds` + endpoint list) so Diagnostics doesn’t show stale “UI missing” items.
  - Verify by opening the dashboard → Settings → Diagnostics → Definitions and confirming the moved items show **UI OK** (and removed items no longer appear).
- `extensions/live-visitors-pixel/` – Web Pixel extension (`shopify.extension.toml` + `src/index.js`).
- `.env.example` – All env vars with short descriptions.
- `docs/CONFIG.md` – Env vars, URLs, ingest secret, common mistakes.

## Env vars you must set

Minimum for a working install:

- `SHOPIFY_API_KEY` (or `SHOPIFY_CLIENT_ID`)
- `SHOPIFY_API_SECRET` (or `SHOPIFY_CLIENT_SECRET`)
- `SHOPIFY_APP_URL`
- `INGEST_SECRET` (same value in pixel extension settings)

Optional: `DB_URL` (Postgres), time windows, rate limits (see `.env.example`).

## Admin routes

- Login: `https://<your-app-url>/` (redirects to `/dashboard/overview` when authenticated).
- Overview: `https://<your-app-url>/dashboard/overview`
- Live View: `https://<your-app-url>/dashboard/live`
- Recent Sales: `https://<your-app-url>/dashboard/sales`
- Table View: `https://<your-app-url>/dashboard/table`
- Countries: `https://<your-app-url>/insights/countries`
- Products: `https://<your-app-url>/insights/products`
- Channels: `https://<your-app-url>/traffic/channels`
- Device & Platform: `https://<your-app-url>/traffic/device`
- Google Ads: `https://<your-app-url>/tools/ads`
- Conversion Rate Compare: `https://<your-app-url>/tools/compare-conversion-rate`
- Settings: `https://<your-app-url>/settings`

## Pixel ingest URL and secret

- **URL**: `https://<your-app-url>/api/ingest`
- **Secret**: Set in pixel extension settings (Ingest Secret) and in server `.env` as `INGEST_SECRET`. The pixel sends it in the `X-Ingest-Secret` header.
