# Cloudflare ingest setup – Phase 1 (All vs Human)

This guide walks through the Cloudflare UI so ingest traffic gets CF metadata and the dashboard can show **All** vs **Human** (human = exclude known/verified bots).

**Prerequisites:** Your ingest URL must go through Cloudflare (orange cloud). If the pixel posts to Railway directly, add a CF-proxied hostname and point the pixel at that; see `CR_FIX_PHASE2_CF.md` section 2A.

**Use this ingest URL everywhere** (pixel Ingest URL, Worker route, DNS, etc.):  
`https://lv-ingest.hbdjewellery.com/api/ingest`

**Your setup (use these):**
- **Origin (Railway):** `https://liveview-production.up.railway.app`
- **Ingest host (CF proxy):** `lv-ingest.hbdjewellery.com` → full ingest URL: `https://lv-ingest.hbdjewellery.com/api/ingest`

---

## 1. Create the Worker

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Select your **account** (not a zone) in the left sidebar.
3. Go to **Workers & Pages**.
4. Click **Create** → **Create Worker**.
5. Name it (e.g. `liveview-ingest-enrich`).
6. Click **Edit code** (or **Deploy** then **Edit code**).
7. Replace the default script with the contents of **`workers/ingest-enrich.js`** in this repo. Copy the whole file.
8. Click **Save and Deploy**.

---

## 2. Set environment variables

1. In the Worker page, open **Settings**.
2. Under **Variables**, click **Add variable** (or **Edit variables**).
3. Add:
   - **Variable name:** `ORIGIN_URL`  
     **Value:** `https://liveview-production.up.railway.app` (no trailing slash).  
     **Type:** Encrypt (recommended) or Plain text.
   - (Optional) **Variable name:** `BLOCK_KNOWN_BOTS`  
     **Value:** `1` if you want to block known bots at the edge (they never reach your app). Leave unset or `0` to only tag them and filter in the dashboard.
4. Save. Redeploy the worker if prompted.

---

## 3. Add a route so the Worker runs on ingest

1. Still in **Workers & Pages**, select your worker.
2. Go to **Triggers**.
3. Under **Routes**, click **Add route**.
4. **Route:**  
   - **Use:** `*lv-ingest.hbdjewellery.com/api/ingest*`  
   (Pixel Ingest URL will be `https://lv-ingest.hbdjewellery.com/api/ingest`.)
5. **Zone:** pick the zone for `hbdjewellery.com`.
6. Click **Save**.

Now every request to that path goes through your worker, which adds CF headers and forwards to `ORIGIN_URL`.

---

## 4. Inject bot signal so the Worker can use it (recommended)

The worker prefers the bot signal from a header set by a Cloudflare **Request Header Transform Rule** (from `cf.client.bot`). Without this, it falls back to `request.cf.verifiedBotCategory`, which may be empty on some plans.

**Note:** Cloudflare does **not** allow setting headers whose names start with `x-cf-` or `cf-`. So we use a custom header **`x-lv-client-bot`**; the Worker reads it and then sets `x-cf-known-bot` when forwarding to your origin.

### Current Cloudflare UI (2024–2025)

**Where to find it:** Zone → **Rules** → **Overview** → **Create rule** → **Request Header Transform Rule**.  
(If you don’t see “Request Header Transform Rule”, see [Cloudflare: Create a request header transform rule](https://developers.cloudflare.com/rules/transform/request-header-modification/create-dashboard/).)

1. In the Cloudflare dashboard, select the **zone** (e.g. **hbdjewellery.com**), not the account.
2. In the left sidebar go to **Rules** → **Overview** (the Rules Overview page).
3. Click **Create rule** → **Request Header Transform Rule**.
4. **Rule name:** e.g. `Ingest – set x-lv-client-bot`.
5. **When incoming requests match:** choose **Custom filter**, then set **Field** = URI Path, **Operator** = equals, **Value** = `/api/ingest`. (Or in Expression Editor: `http.request.uri.path eq "/api/ingest"`.)
6. **Modify request header:** **Set dynamic**, **Header name** = `x-lv-client-bot`, **Value** = `if(cf.client.bot, "1", "0")`.
7. Click **Deploy** (or **Save as Draft** if you want to deploy later).

**Legacy / alternate UI (if your dashboard looks different):**
5. **When:**  
   - **Field:** URI Path  
   - **Operator:** equals  
   - **Value:** `/api/ingest`  
   (Or use “ends with” `/api/ingest` if you have a prefix.)
6. **Then:**
   - **Operation:** Set dynamic (or Set static if your UI only has static).
   - **Header name:** `x-lv-client-bot`
   - **Value:** use an expression so the header is `1` or `0` from `cf.client.bot`:
     - New Ruleset Engine: **Expression** and use:  
       `if(cf.client.bot, "1", "0")`  
     - If your UI has “Dynamic” and a simple expression builder, choose “Bot detection” / `cf.client.bot` and map `true` → `1`, `false` → `0` if possible.
7. Click **Deploy** (or **Save as Draft** if you want to deploy later).

Order of execution: the Request Header Transform Rule runs first and sets `x-lv-client-bot`, then the request hits your Worker. The Worker reads `x-lv-client-bot` (or `x-cf-client-bot` / `cf-client-bot` if present) and `request.cf`, then sets `x-cf-known-bot` etc. and forwards to your origin.

---

## 5. Verify

1. **Trigger a pixel event** (load a store page that has the pixel, or use your app’s test).
2. In your app (or DB), confirm that the session/event has:
   - `cf_known_bot` = 0 or 1
   - `cf_country` (and optionally `cf_colo`, `cf_asn`) when the request came through CF.
3. In the **Live Visitors** dashboard, use the **Human** toggle: numbers should drop when you switch from All to Human (fewer sessions = bots excluded).

---

## Summary

| Step | Where | What |
|------|--------|------|
| 1 | Workers & Pages → Create Worker | Paste `workers/ingest-enrich.js`, Save and Deploy |
| 2 | Worker → Settings → Variables | `ORIGIN_URL` = `https://liveview-production.up.railway.app`; optional `BLOCK_KNOWN_BOTS` = `1` |
| 3 | Worker → Triggers → Routes | Add route `*lv-ingest.hbdjewellery.com/api/ingest*` |
| 4 | Zone → Rules → Overview → Request Header Transform Rule | When path = `/api/ingest` → Set **x-lv-client-bot** = `if(cf.client.bot, "1", "0")` |

After this, ingest traffic is enriched with CF metadata and the dashboard **All** vs **Human** filter works (default is Human). The app stores `cf_known_bot` and stats can exclude bots when Human is selected.
