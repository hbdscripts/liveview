# KEXO Liveview — Current state (handover)

**Last updated:** 2026-02-18

Read this file before making changes. If you change **core paths** (routes, auth, dashboard UX, ingest, DB schema, deploy), update this file in the same commit.

---

## Route map (canonical pages)

- **Dashboard:** `/dashboard/overview`, `/dashboard/live`, `/dashboard/sales`, `/dashboard/table`
- **Insights:** `/insights/snapshot`, `/insights/countries`, `/insights/products`, `/insights/variants`, `/insights/abandoned-carts`
- **Acquisition:** `/acquisition/attribution`, `/acquisition/devices`
- **Integrations:** `/integrations/google-ads`
- **Tools:** `/tools/compare-conversion-rate`, `/tools/shipping-cr`, `/tools/click-order-lookup`, `/tools/change-pins`
- **Settings:** `/settings` (tabs: kexo, integrations, layout, attribution, insights, cost-expenses, admin). Layout has Tables, KPIs, Date ranges only (chart settings via cog on each chart). Admin-only content gated by `isMasterRequest`.
- **Auth:** `/app/login` (Google); `/admin` → redirect to `/settings?tab=admin` or `/settings?tab=kexo`
- **Root `/`:** Shopify embed or redirect to dashboard/login

Templates under `server/public/**`; served via `sendPage()` in `server/index.js`.

---

## UX invariants

- **Settings page** must **never** show the page-body overlay loader (locked off in frontend/runtime).
- Modal convention: dark overlays (`.modal-backdrop`); custom modals must match.
- KPI/chart styling: do not hardcode sparkline/delta colors; use `charts_ui_config_v1.kpiBundles`.
- Diagnostics: when adding/moving/removing dashboard sections, update `server/trackerDefinitions.js`.

---

## Guardrails (non-negotiable)

- **No deletes from app tables** (`purchases`, `sessions`, `purchase_events`, `orders_shopify`) to “fix numbers”. Over-reporting: handle via **dedupe in stats queries** only (e.g. exclude duplicate `h:` rows when token/order row exists for same session+total+currency+15min). See `server/store.js`.
- **Sales/product mapping:** `/api/latest-sales` must resolve a single truth line item (`product_id` + `product_title`); open Product Insights by `product_id` when handle is missing.
- **Incident/perf:** For “site down”/spinner reports: query Sentry **transactions/spans** first (not only Issues); check last 30–60 min for slow `GET /dashboard/overview`, `/api/kpis`, `/api/kexo-score`, `/api/kpis-expanded-extra`; include `release`; do not declare fixed until new traces show improved latency.
- **Runtime:** No global mutable Postgres transaction client; no `await` of long-running reconcile/backup in hot request paths; pre-reconcile backups non-blocking.
- **Sentry:** Config in `server/config.js` (sentryDsn); `.env.example` has SENTRY_DSN. For this app use Sentry MCP with region `https://de.sentry.io` when querying.

---

## Key paths

- **Ingest:** `POST /api/ingest` → `server/store.js`
- **Auth:** `server/middleware/dashboardAuth.js` (Shopify embed + OAuth cookie); `server/routes/login.js`, `oauthLogin.js`, `auth.js`, `localAuth.js`
- **KPIs / dashboard:** `GET /api/kpis`, `/api/kpis-expanded-extra`, `/api/kexo-score`, `/api/dashboard-series`, `/api/business-snapshot`; `server/store.js`, `server/routes/dashboardSeries.js`, `server/businessSnapshotService.js`
- **Settings:** `GET/POST /api/settings`; `GET/PUT /api/chart-settings/:chartKey` (per-chart settings; stored in same `charts_ui_config_v1` blob). Auth: protected by `dashboardAuth` (same as `/api/settings`); writes are **not** `requireMaster`-gated today. UI: `server/public/settings.html`, `settings-page.js`; chart cog opens unified modal from `client/app/18-chart-settings-builder.js`.
- **Frontend bundle:** `server/public/app.js` is **generated** from `client/app/*.js` via `scripts/build-app-js.js` and `client/app/manifest.txt`. After any `client/app/**` edit, run `npm run build:app`.

---

## Changelog (this consolidation)

- 2026-02-18: Cleanup/standardise branch: Phase 0 safety branch; Phase 2 docs consolidation (HANDOVER.md, docs/CONFIG, ARCHITECTURE, METRICS); Phase 3 single config source (server/config.js); Phase 4 shared client utils (00-utils.js, formatters/fetchJson); Phase 5 upgrade.html head-theme include; Phase 6 validation (npm test, migrate, smoke /health, /api/version, /app/login).
- 2026-02-18: Charts and UI standardise branch: Phase 1 Tabler UI contract, UI kit, ui:check, Phase 2 AGENT_RULES + wrappers; Phase 3 unified chart settings: Settings Charts panel removed; GET/PUT /api/chart-settings/:chartKey; 18-chart-settings-builder.js (cog → modal: type, size, animation, big-chart colours); chart modal removed from 16-layout-shortcuts (delegates to 18).
