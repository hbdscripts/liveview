# Plan: Lock Down Dashboard (No Public Stats)

**Goal:** Live Visitors stats must not be public on the Railway URL. Access only via:
1. **Shopify admin UI** (embedded app – already authenticated by Shopify), or  
2. **Direct Railway URL** with password protection so you can view the dashboard when needed.

---

## What to protect

- **Dashboard UI:** `GET /app/live-visitors`, `GET /` (when it serves the app)
- **Data APIs used by the dashboard:**  
  `GET /api/sessions`, `GET /api/stream`, `GET /api/sessions/:id/events`,  
  `GET /api/settings/tracking`, `PUT /api/settings/tracking`, `GET /api/config-status`

**Leave public (no password):**
- `POST /api/ingest` (pixel must reach it; already protected by `INGEST_SECRET`)
- `GET /health` (for Railway/probes)
- `GET /auth/callback`, `GET /auth/shopify/callback`, `GET /` when it’s OAuth redirect

---

## Access rules

Allow access to protected routes if **either**:

1. **From Shopify admin**  
   Request is from the embedded app (e.g. `Referer` contains `admin.shopify.com` or `*.myshopify.com/admin`). No password.

2. **Direct visit with password**  
   Request is direct to Railway URL and has a valid “dashboard secret” (e.g. cookie set after login, or a shared secret in header/query for API calls from the dashboard page).

If neither applies: for **HTML** (dashboard) show a **login page**; for **API** return **401 Unauthorized**.

---

## Config

- **Env var:** `DASHBOARD_SECRET` (or `DASHBOARD_PASSWORD`)  
  - Single shared secret you set (e.g. long random string, same as you’d use for a password).  
  - If **unset/empty:** keep current behaviour (all dashboard routes public) so existing setups don’t break.  
  - If **set:** enable the protection logic above.

Add to `server/config.js` and `.env.example` with a short comment. No hard-coded secrets.

---

## Implementation outline

1. **Config**  
   - Read `DASHBOARD_SECRET` in `server/config.js`.  
   - Document in `.env.example` and `config/APP_CONFIG.md`.

2. **Middleware**  
   - One middleware that runs only for the protected paths listed above.  
   - If `DASHBOARD_SECRET` is not set → `next()` (no protection).  
   - If set:  
     - **Allow** if `Referer` looks like Shopify admin (e.g. `https://admin.shopify.com` or `https://*.myshopify.com/admin`).  
     - **Allow** if request has valid dashboard secret: e.g. cookie `dashboard_session` (signed/verified) or header `X-Dashboard-Secret: <DASHBOARD_SECRET>` (or query param for initial login only).  
   - Otherwise:  
     - For `GET /app/live-visitors` or `GET /` (dashboard): redirect to a small **login page** route (e.g. `GET /app/login`) or serve a login HTML that POSTs the password and sets a signed cookie.  
     - For API routes: `res.status(401).json({ error: 'Unauthorized' })`.

3. **Login flow (direct Railway URL only)**  
   - Route: e.g. `GET /app/login` → serve minimal HTML form (password field, submit).  
   - POST handler: compare with `DASHBOARD_SECRET`; if correct, set an HTTP-only cookie (e.g. signed with a server secret or HMAC) and redirect to `/app/live-visitors`.  
   - Dashboard page and API calls from it (same origin) will send the cookie; middleware allows them.

4. **APIs called by the dashboard**  
   - When the dashboard is loaded **inside Shopify admin**, requests to `/api/sessions`, `/api/stream`, etc. will have `Referer: https://admin.shopify.com/...` → middleware allows.  
   - When you open the dashboard **directly** on Railway after logging in, the same-origin requests send the cookie → middleware allows.

5. **Optional:**  
   - Logout link on the dashboard (clears cookie, redirects to login).  
   - Short session expiry for the cookie (e.g. 24h) if you want.

---

## Summary

| Scenario                    | Result                                      |
|---------------------------|---------------------------------------------|
| Open app from Shopify     | Allowed (Referer = admin)                   |
| Open Railway URL, no auth | Login page → enter password → dashboard     |
| Open Railway URL + cookie | Allowed (stats only with password or Shopify) |
| Ingest / health / auth    | Unchanged (no dashboard password required)   |

After redeploy and reinstall, you can implement this using the outline above; start with config + middleware + login page, then wire the cookie for direct access.
