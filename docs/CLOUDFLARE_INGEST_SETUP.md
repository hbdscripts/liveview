# Cloudflare Worker + Rules: Filter All Bots (Google, Bing, Merchant Center, etc.)

The Kexo ingest runs through a Cloudflare Worker (`workers/ingest-enrich.js`) that can **block known bots at the edge** so they never reach your app or DB. For that to work you need:

1. **Worker env:** `BLOCK_KNOWN_BOTS=1`
2. **Cloudflare rule:** A Request Header Transform Rule that sets `x-lv-client-bot` when the request is from a known bot (so the Worker can block it).

Without the rule, the Worker only sees bot signals from `request.cf.botManagement` (verified bot, category), which may be **empty on some plans**. So the rule is the main way to ensure Google, Bing, Merchant Center, and other verified crawlers are flagged and blocked.

---

## Step 1: Enable blocking and reporting in the Worker

In **Cloudflare Dashboard → Workers & Pages → your Worker (e.g. kexo-ingest-enrich) → Settings → Variables**:

- Add or edit **BLOCK_KNOWN_BOTS** = **1** (plain text).
- Add **INGEST_SECRET** = **same value as your app’s INGEST_SECRET** (use a **Secret** so it isn’t visible).  
  When set, the Worker POSTs to your app’s `/api/bot-blocked` each time it blocks a bot, and the config panel (click **i**) shows **Bots blocked: X** for today.

Redeploy the Worker if you change env vars.

---

## Step 2: Request Header Transform Rule (mark all known bots)

This rule runs **before** the Worker. When Cloudflare identifies the request as a known (verified) bot, it sets a header the Worker reads.

1. In **Cloudflare Dashboard** select your zone (e.g. **kexo.io**).
2. Go to **Rules** → **Transform Rules** → **Request Header Transform Rules**.
3. **Create rule** → **Request Header Transform Rule**.
4. **Rule name:** e.g. `Kexo – mark bots for ingest`.
5. **When incoming requests match:**  
   - Choose **Custom filter expression** (Expression Editor).  
   - Use one of the following.

**Option A – Only ingest path (recommended)**  
So only requests to your ingest endpoint get the header:

```text
(http.request.uri.path eq "/api/ingest" or ends_with(http.request.uri.path, "/api/ingest")) and cf.client.bot eq true
```

**Option B – All requests from known bots**  
If you prefer to mark every known-bot request (Worker still only blocks on `/api/ingest`):

```text
cf.client.bot eq true
```

6. **Then:**  
   - **Set static** (or **Set**).  
   - **Header name:** `x-lv-client-bot`  
   - **Value:** `1`  
7. **Deploy** the rule.

**What this does:**  
`cf.client.bot` is true for requests Cloudflare classifies as **known good bots** (e.g. Google, Bing, Merchant Center, other verified crawlers). Those requests get `x-lv-client-bot: 1`. The Worker then treats them as bots and, when `BLOCK_KNOWN_BOTS=1`, returns 204 and does not forward them to your origin, so they never create sessions in your DB.

**Plan note:**  
`cf.client.bot` is available in the Rules language when **Bot Management** or **Super Bot Fight Mode** (Pro/Business/Enterprise) is enabled for the zone. If you don’t see it, enable bot protection for the zone first.

---

## Step 3 (optional): Also flag likely bots by score

If you have **Bot Management** (e.g. Enterprise) and want to block not only verified bots but also requests with a low “human” score:

1. Add another **Request Header Transform Rule** (or extend the same rule if your plan allows multiple header actions).
2. **When incoming requests match** (Expression Editor), e.g. for ingest path and low bot score:

```text
(http.request.uri.path eq "/api/ingest" or ends_with(http.request.uri.path, "/api/ingest")) and cf.bot_management.score lt 30
```

3. **Then:** Set header **x-lv-client-bot** = **1**.

Adjust the threshold (e.g. `lt 30`) to taste. The Worker blocks any request that has `x-lv-client-bot` set to a truthy value when `BLOCK_KNOWN_BOTS=1`.

---

## Verify

- **Sessions vs Shopify:**  
  If your sessions still match Shopify’s after this, either:
  - The rule isn’t firing (e.g. `cf.client.bot` not available on your plan, or path/expression wrong), or  
  - `BLOCK_KNOWN_BOTS` isn’t set to `1` in the Worker, or  
  - The Worker route isn’t attached to the hostname/path that receives the pixel (e.g. `ingest.kexo.io/api/ingest`).

- **Config panel:**  
  After blocking is working, “Bots blocked (est.)” in the dashboard config (click **i**) should be roughly **Shopify Sessions − Sessions (ours)** for today.

---

## See if the Worker is doing anything

**1. Transform Rule first**  
Blocking only happens when a request is marked as a bot. That needs the **Request Header Transform Rule** (Step 2 above) to set `x-lv-client-bot = 1` when `cf.client.bot eq true`. Without that rule, the Worker runs on every request but never sees a bot signal, so it never blocks.

**2. Cloudflare Worker metrics**  
- **Dashboard → Workers & Pages → kexo-ingest-enrich → Metrics**  
  - **Requests** = total requests to `ingest.kexo.io/api/ingest` (both forwarded and blocked).  
  - **Errors** = failures (e.g. upstream down).  
  So you can see that the Worker is being hit; you can’t see “block count” there by default.

**3. Workers Logs / Tail (see individual requests and blocks)**  
- **Workers Logs** is already enabled for you. In the Worker page, open **Logs** (or **Real-time Logs**) to see recent requests.  
- When the Worker **blocks** a bot it returns **204** and sets response header **`x-lv-blocked: bot`**. In logs/traces you’ll see that 204 response and can filter or spot blocked requests.  
- For a live stream: from your machine run **`wrangler tail kexo-ingest-enrich`** (from the `workers/` directory, with Wrangler logged in). You'll see each request; when a bot is blocked you'll see the 204 and the `x-lv-blocked: bot` header in the response.

**4. Enable Workers Traces (optional)**  
- In the Worker **Settings → Observability**, turn **Workers Traces** to **Enabled**. Then in Logs you get more detail per request (headers, etc.), which helps confirm that blocked requests have `x-lv-blocked: bot`.

**Summary:**  
- **Metrics** = “is the Worker getting traffic?”  
- **Logs / Tail** = “which requests are 204 with `x-lv-blocked: bot`?” (those are blocks).  
- **Sessions vs Shopify** = “are we blocking enough?” (ours should be lower once the Transform Rule is in place and firing).

---

## Reference

- Worker logic: `workers/ingest-enrich.js`  
  - Reads `x-lv-client-bot` (set by the rule above).  
  - Also uses `request.cf.botManagement.verifiedBot` and `request.cf.botManagement.verifiedBotCategory` when present.  
  - `knownBot = true` → block (204) when `BLOCK_KNOWN_BOTS=1`.
- Cloudflare: [cf.client.bot](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/cf.client.bot/), [Request Header Transform Rules](https://developers.cloudflare.com/rules/transform/request-header-modification/).
