# Architecture (repo layout + data flow)

---

## Repo layout

```
server/           Express app, routes, middleware, migrations, public HTML/JS/CSS
  index.js        App entry, page routes, auth, static assets, startup migrations
  config.js       Single env/config source (process.env → config.*)
  store.js        DB access, reporting, dedupe helpers
  migrations/     Schema migrations (run on startup)
  routes/         API and page handlers
  public/         Static assets, partials, HTML pages (app.js is generated from client/app)
  middleware/     dashboardAuth, requireMaster, etc.
client/app/       Source for app bundle (manifest.txt → build-app-js.js → server/public/app.js)
scripts/          build-app-js.js, prune-runtime-files.js, generate-ingest-secret.js, etc.
workers/         Cloudflare Worker (ingest-enrich) — Wrangler
extensions/      Shopify Web Pixel extension
config/          (optional) app config notes
docs/            CONFIG.md, ARCHITECTURE.md, METRICS.md, etc.
```

---

## Data flow (high level)

```
[Storefront] → Pixel → POST /api/ingest → store.js → sessions / events / purchases
                                    ↓
[Shopify Admin] → Embed → GET / → dashboardAuth → sendPage() → HTML + app.js
                                    ↓
[Browser] → app.js → GET /api/kpis, /api/dashboard-series, ... → store.js / routes
                                    ↓
[Orders] ← Shopify REST/GraphQL ← salesTruth / reconcile (background)
```

- **Ingest:** Pixel sends events to `/api/ingest`; server writes to `sessions`, `events`, `purchases` (append-only; no deletes).
- **Dashboard:** Auth via Shopify embed (no login) or Google OAuth (direct visit). Pages are server-rendered HTML; `app.js` (built from `client/app/*.js`) drives KPIs, charts, tables.
- **Sales truth:** Background reconciliation syncs Shopify orders into `orders_shopify`; reporting can use pixel-derived `purchases` or Shopify truth; dedupe in queries only (see METRICS.md and HANDOVER.md).

---

## Key guardrails

- **DB:** No deletes from `purchases`, `sessions`, `purchase_events`, `orders_shopify` to fix numbers; use dedupe in stats queries and backups for recovery.
- **Settings:** Settings page must never show the page-body overlay loader.
- **Runtime:** No global Postgres transaction client; no blocking hot paths on long-running reconcile/backup; pre-reconcile backups are non-blocking.
- **Sentry:** Used for errors and performance; query transactions first for “site down” reports.
