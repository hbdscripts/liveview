# Automatic deploy (backend + pixel on push)

When you push to `main`:

- **Railway** deploys the backend (if the repo is connected to Railway).
- **GitHub Actions** deploys the Web Pixel (and app config) to Shopify via `.github/workflows/deploy-shopify.yml`.

## One-time setup for pixel deploy

1. **Partner Dashboard** → **Settings** → **CLI token** → **Manage tokens** → **Generate token**. Copy the token (it’s only shown once).
2. **GitHub** → your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - Name: `SHOPIFY_CLI_PARTNERS_TOKEN`
   - Value: (paste the token)
3. If your `shopify.app.toml` has an empty `client_id`, add another secret:
   - Name: `SHOPIFY_API_KEY`
   - Value: your app’s Client ID (same as in Railway)

After that, every push to `main` runs the deploy workflow; the pixel is deployed to Shopify and stays in sync with the repo.
