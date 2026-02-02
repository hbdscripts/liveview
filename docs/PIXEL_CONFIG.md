# Pixel configuration (developer app)

The Live Visitors Web Pixel extension has two settings: **Ingest URL** and **Ingest Secret**. When a merchant **installs the app and opens it**, the app automatically creates or updates the pixel on that store (no manual mutation). If you need to set the pixel manually (e.g. before OAuth was fixed), use the GraphQL approach below.

## Install normally = pixel auto-configured

1. Merchant installs the app on a store (OAuth runs, we store the access token).
2. Merchant opens the app (dashboard loads with `?shop=xxx` in the URL).
3. The dashboard calls **GET /api/pixel/ensure?shop=xxx**; the server uses that store’s token to create or update the web pixel with Ingest URL and Ingest Secret from your server config.
4. The pixel shows as **Connected** in Settings → Customer events → App pixels. No manual mutation needed.

## How to set Ingest URL and Ingest Secret

### Option A: Run the mutation from your project (recommended)

1. In the repo root, ensure `.env` has:
   - `SHOPIFY_APP_URL` = your app URL (e.g. `https://liveview-production.up.railway.app`)
   - `INGEST_SECRET` = the same secret you use on Railway for the ingest endpoint

2. Run:
   ```bash
   node scripts/configure-pixel.js
   ```
   That prints a **GraphQL mutation** with your Ingest URL and Ingest Secret filled in.

3. Run your app in dev so you have an authenticated GraphQL session:
   ```bash
   shopify app dev
   ```
   In the terminal, Shopify CLI will show a **GraphiQL** URL (e.g. for API exploration). Open it in your browser.

4. In GraphiQL, paste the mutation that `configure-pixel.js` printed and run it. That creates (or updates) the web pixel on the store with your settings.

5. In the store: **Settings → Customer events → App pixels**. “Live Visitors” should show as **Connected**. Visit your storefront; events should flow to your dashboard.

### Option B: Call the API yourself

If you have an Admin API access token for the store (e.g. from OAuth or a custom app), you can call:

- **Create:** `webPixelCreate` with `webPixel: { settings: "{\"ingestUrl\":\"https://...\",\"ingestSecret\":\"...\"}" }`
- **Update:** `webPixelUpdate` with the pixel `id` and new `settings` JSON.

The `settings` JSON must match the fields in `extensions/live-visitors-pixel/shopify.extension.toml` (`ingestUrl`, `ingestSecret`).

## Scopes

The app needs **write_pixels** and **read_customer_events** to create/update the pixel. These are in `shopify.app.toml`. If you added the app before that change, reinstall the app (or re-authorize) so the store grants the new scopes.

## After configuration

- **Settings → Customer events → App pixels**: “Live Visitors” should be **Connected**.
- Open your storefront and browse; the dashboard should show `page_viewed` and other events (and **Tracking** must be ON in the dashboard).
