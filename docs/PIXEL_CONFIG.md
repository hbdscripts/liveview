# Pixel configuration (developer app)

The Live Visitors Web Pixel extension has two settings: **Ingest URL** and **Ingest Secret**. These are **not** set in a Dev Dashboard “Extensions → Configuration” screen. Shopify expects pixel settings to be set via the **GraphQL Admin API** (`webPixelCreate` / `webPixelUpdate`).

## Why you don’t see “Extensions → Configuration”

For app pixels, settings are defined in the extension’s `shopify.extension.toml` (which we have). The **values** for those settings (Ingest URL, Ingest Secret) are stored when your app (or you) calls the Admin API to create or update the web pixel on the store. There is no separate “configuration” UI in Dev Dashboard for these fields.

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
