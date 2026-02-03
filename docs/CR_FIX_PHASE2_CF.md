# CR fix – Phase 2: Cloudflare enrichment + human-only (no bot score)

**Constraint:** Cloudflare Business (~$200/mo). We do **not** have Enterprise Bot Management numeric scoring (cf.bot_management.score). We use only:
- **cf.client.bot** (known/verified bot indicator) and verified bot categories.
- Super Bot Fight Mode outcomes at the edge (no per-request score stored).

**Confirmation:** Bot scoring (1–99 score) is **NOT** used anywhere in this app.

---

## 2A) Ingest URL and Cloudflare proxy

**Current behaviour:** Ingest URL is built from `SHOPIFY_APP_URL` (e.g. `https://liveview-production.up.railway.app/api/ingest`). If that domain is **not** behind Cloudflare (orange cloud), pixel traffic bypasses CF and the Worker (2B) will never run; `x-cf-*` headers will be absent and backend will store null for CF fields.

**Check:** If the pixel posts directly to your app (e.g. Railway/Render origin URL), traffic **bypasses** Cloudflare and we get no CF headers (cf.client.bot, etc.).

**If bypassing:**
1. Create a **Cloudflare-proxied** hostname for ingest, e.g. `lv-ingest.<your-domain.com>` or a route under your existing CF-proxied domain that forwards to your origin.
2. In Cloudflare DNS: add a CNAME (or A) for that hostname and **proxy** (orange cloud) so requests go through CF.
3. Update pixel settings (Ingest URL) to use that hostname, e.g. `https://lv-ingest.<your-domain.com>/api/ingest`. Do **not** change theme; only pixel extension settings (GraphQL or app UI).
4. Origin (Railway) must accept requests from that hostname (e.g. same origin or allow the Host header).

**If already proxied:** Ingest URL is already behind CF (e.g. `https://your-app.example.com/api/ingest` and that domain is proxied by CF). No change needed; Worker (2B) can run on that route.

---

## 2B) Worker-based enrichment (no score)

A Cloudflare Worker on the ingest hostname/path:
- Reads available CF signals: **request.cf** (e.g. `clientBot`, `verifiedBotCategory`, `country`, `colo`, `asn`). Exact property names depend on plan; see [CF request.cf docs](https://developers.cloudflare.com/workers/runtime-apis/request/).
- Adds headers to the request before forwarding to origin:
  - `x-cf-known-bot`: `1` if known/verified bot, else `0` (or empty if unavailable).
  - `x-cf-verified-bot-category`: string or empty.
  - `x-cf-country`: country code.
  - `x-cf-colo`: colo code.
  - `x-cf-asn`: ASN if available.
- Forwards the request to origin **unchanged** except for added headers. **Fail-open:** if Worker errors, still forward (or return 502 and rely on retries).

**Note:** On Business plan, `request.cf.botManagement` may be null (no numeric score). We use `request.cf.botManagement?.verifiedBot` (boolean) and `request.cf.verifiedBotCategory` (string). If `botManagement` is null, `x-cf-known-bot` is set to `0`. We do **not** use `request.cf.botManagement.score` anywhere.

Worker code is in `workers/ingest-enrich.js`. Deploy with Wrangler; set `ORIGIN_URL` in Worker settings to your origin (e.g. Railway URL).

---

## 2C) Backend persist + TRAFFIC_MODE + dashboard

**Backend ingest:**
- Read headers: `x-cf-known-bot`, `x-cf-verified-bot-category`, `x-cf-country`, `x-cf-colo`, `x-cf-asn`.
- Store on **sessions** (and optionally visitors): `cf_known_bot`, `cf_verified_bot_category`, `cf_country`, `cf_colo`, `cf_asn`.

**Stats:**
- New config **TRAFFIC_MODE** = `all` | `human_only` (default `all`).
- When `human_only`: exclude sessions where `cf_known_bot = 1` (and optionally exclude certain verified bot categories).
- Stats response includes breakdown: `total_sessions`, `human_sessions`, `known_bot_sessions`.

**Dashboard:**
- Toggle or query param `?traffic=human` wired to stats calls so user can switch All vs Human-only.

---

## Worker code (2B) – minimal

See `workers/ingest-enrich.js` in this repo for the Worker script to deploy in Cloudflare Workers. It:
- Matches the ingest path (e.g. `/api/ingest`).
- Reads `request.cf` (country, colo, asn, botManagement?.verifiedBot, verifiedBotCategory) and sets the headers above. **Does not use `request.cf.botManagement.score`**.
- Forwards to your origin (env var `ORIGIN_URL`). Non-ingest requests are forwarded unchanged.

---

## Deliverables (Phase 2)

| Item | Location |
|------|----------|
| 2A Ingest URL / CF proxy note | This doc (2A section) |
| 2B Worker | `workers/ingest-enrich.js`, `workers/wrangler.toml` |
| 2C Migration (CF columns on sessions) | `server/migrations/009_cf_traffic.js` |
| 2C Ingest reads CF headers, passes to store | `server/routes/ingest.js` (getCfContextFromRequest, upsertSession with cfContext) |
| 2C Store persists CF, stats filter + breakdown | `server/store.js` (upsertSession CF columns, sessionFilterForTraffic, getStats options, getSessionCounts, trafficBreakdown) |
| 2C TRAFFIC_MODE config | `server/config.js`, `.env.example` |
| 2C Stats query param ?traffic=human | `server/routes/stats.js` |
| 2C Dashboard toggle All / Human only | `server/public/live-visitors.html` |

**Confirmation:** Bot scoring (1–99 numeric score) is **not** used anywhere in this app or Worker. Only `cf.botManagement?.verifiedBot` (boolean) and `cf.verifiedBotCategory` (string) are used when available.
