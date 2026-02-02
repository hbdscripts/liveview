# Live Visitors App – Configuration

## Where to get Shopify credentials

1. **Partner / Custom app**
   - Go to [Shopify Partners](https://partners.shopify.com) (or your store Admin → Apps → Develop apps).
   - Create an app (or use a custom app for a single store).
   - Copy **Client ID** → `SHOPIFY_API_KEY` (or `SHOPIFY_CLIENT_ID`).
   - Copy **Client secret** → `SHOPIFY_API_SECRET` (or `SHOPIFY_CLIENT_SECRET`).

2. **App URL and redirect URLs**
   - Set **App URL** to your deployed app root (e.g. `https://your-app.example.com`).
   - Add **Allowed redirection URL(s)**:
     - `https://your-app.example.com/auth/callback`
     - `https://your-app.example.com/auth/shopify/callback`
   - In `.env`: `SHOPIFY_APP_URL=https://your-app.example.com`.

3. **Ingestion secret**
   - Run: `node scripts/generate-ingest-secret.js`
   - Copy the output and set in `.env`: `INGEST_SECRET=<paste>`
   - In the Web Pixel extension settings (Shopify Admin → Apps → Live Visitors → Pixel settings), set:
     - **Ingest URL**: `https://your-app.example.com/api/ingest`
     - **Ingest Secret**: the same value as `INGEST_SECRET`.

## Common mistakes

- **CORS**: The ingest endpoint allows `Origin: null` and returns permissive CORS. Do not require credentials.
- **Pixel not loading**: Ensure the pixel extension has `customer_privacy` set so it can run without consent (analytics=false, marketing=false, preferences=false, sale_of_data=disabled).
- **No rows in dashboard**: Check that `INGEST_SECRET` matches in `.env` and in the pixel extension settings. Browse the storefront; the first event is usually `page_viewed`.
- **Tracking off**: Use the admin “Tracking toggle” or set the DB setting `tracking_enabled` to `true`. Ingestion returns 204 when tracking is disabled.

## Scopes

Keep scopes minimal: `read_products`, `read_orders` (or whatever your app needs). Set in `.env` as `SHOPIFY_SCOPES=read_products,read_orders`.

## Sentry (optional)

Set `SENTRY_DSN` in `.env` (or Railway Variables) to send server errors to Sentry. Leave empty to disable. See [docs/SENTRY_SETUP.md](../docs/SENTRY_SETUP.md) for full walkthrough. In this project, Cursor agents have access to Sentry; when asked to "check Sentry" or "look at errors", use that access to query issues and fix causes.
