# Tech stack

Breakdown of technologies used in this project.

---

## Backend (Node server)

| Tech | Purpose |
|------|--------|
| **Node.js** | Runtime (≥18). |
| **Express** | HTTP server, routes, middleware, static files. |
| **better-sqlite3** | SQLite driver (used when `DB_URL` is not set). |
| **pg** | PostgreSQL driver (used when `DB_URL` is set; e.g. Railway). |
| **cors** | CORS for ingest (allow `Origin: null` from pixel). |
| **dotenv** | Load `.env` in development. |
| **geoip-lite** | Derive country from client IP when not behind Cloudflare. |
| **@sentry/node** | Error tracking (optional; set `SENTRY_DSN`). |

- **Database:** SQLite (local) or PostgreSQL (e.g. Railway). All timestamps in epoch ms. Migrations in `server/migrations/`.
- **Hosting:** Railway (production). Health check at `/health`.

---

## Front-end (dashboard)

| Tech | Purpose |
|------|--------|
| **Single HTML file** | `server/public/live-visitors.html` – no build step; vanilla JS, no React/Vue. |
| **Server-Sent Events (SSE)** | Live session updates on Home tab (`/api/stream`). |
| **Fetch API** | All API calls (sessions, stats, config, Shopify sales/sessions, best sellers/variants). |

- **Auth:** From Shopify Admin (embedded app, no login) or Google OAuth when visiting app URL directly (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_COOKIE_SECRET`).

---

## Shopify

| Tech | Purpose |
|------|--------|
| **Shopify Web Pixels API** | Pixel extension runs on storefront; sends events to our ingest. |
| **@shopify/web-pixels-extension** | Pixel extension SDK (`extensions/live-visitors-pixel/`). |
| **Shopify App (OAuth)** | App install → token stored in `shop_sessions`; used for Admin embed and API calls. |
| **Shopify Admin REST API** | Orders (`read_orders`): sales today, best sellers, best variants. |
| **Shopify GraphQL Admin API** | ShopifyQL (`read_reports`) for session count in config panel; often restricted (Protected Customer Data). |
| **Shopify CLI / shopify.app.toml** | App config, deploy extension; scripts in `scripts/` (shopify-deploy.js, shopify-link.js). |

- **Scopes:** `read_products`, `read_orders`, `write_pixels`, `read_customer_events`, `read_reports` (see `.env.example`, `shopify.app.toml`).

---

## Edge / CDN (optional)

| Tech | Purpose |
|------|--------|
| **Cloudflare** | Proxy in front of ingest (e.g. `ingest.kexo.io`); provides `CF-IPCountry`, bot signals. |
| **Cloudflare Worker** | `workers/ingest-enrich.js` – runs on ingest path; enriches requests with CF headers; can block known bots (`BLOCK_KNOWN_BOTS`). Deploy with Wrangler. |
| **Wrangler** | Cloudflare Workers CLI; config in `workers/wrangler.toml`. |

---

## External services / APIs

| Service | Purpose |
|---------|--------|
| **Frankfurter API** | Free FX rates (GBP → other currencies) for converting sales to GBP in reports (`server/fx.js`). |
| **Google OAuth** | Sign-in for direct dashboard access (optional). |
| **Sentry** | Error monitoring (optional). |

---

## CI / CD

| Tech | Purpose |
|------|--------|
| **GitHub Actions** | Manual CI workflow (`.github/workflows/ci.yml`): checkout, Node 20, `npm ci`, `npm run migrate`. |
| **GitHub** | Repo; push to `main` triggers deploy (e.g. Railway). |
| **Railway** | Production host; env vars, Postgres, deploy on push. |

---

## Scripts / tooling

- **npm run dev** – Node server (no prune).
- **npm run start** – Prune non-runtime files, then Node server (production).
- **npm run migrate** – Run DB migrations.
- **npm run deploy** – Shopify CLI deploy (extension + app config).
- **scripts/generate-ingest-secret.js** – Generate `INGEST_SECRET`.
- **scripts/configure-pixel.js** – Help configure pixel (Ingest URL, secret) via GraphQL.

---

## Summary

- **Backend:** Node, Express, SQLite/Postgres, Sentry (optional).
- **Front-end:** Vanilla HTML/JS, SSE.
- **Shopify:** Web Pixel extension, OAuth, REST Orders API, GraphQL ShopifyQL (sessions).
- **Edge:** Optional Cloudflare + Worker (Wrangler).
- **External:** Frankfurter (FX), Google OAuth (optional), Sentry (optional).
- **Host/CI:** Railway, GitHub Actions.
