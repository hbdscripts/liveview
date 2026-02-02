# Deploy: backend vs pixel

## Backend (Railway) – automatic on push

When you push to `main`, **Railway** deploys the backend (if the repo is connected to Railway). No extra setup.

---

## Pixel (Shopify) – depends where the app was created

### App created in **Developers / Dev Dashboard** (dev.shopify.com)

Shopify’s CI deploy (CLI token from Partners) **only works for Partner organization apps**. If your app was created in **Developers** (Dev Dashboard), the GitHub Action **Deploy to Shopify** will not work with a Partner token and will fail with “You are not a member of the requested organization”.

**What to do:** Deploy the pixel **manually** when you change it:

1. Open your project in a terminal (repo root).
2. Log in to the account that owns the app (if needed):  
   `shopify auth login`
3. Deploy:  
   `npm run deploy`  
   (or `shopify app deploy --allow-updates`)
4. Follow the prompts.

After that, the Web Pixel is updated on Shopify. Run it again whenever you change the pixel or app config and want to push to Shopify.

---

### App created in **Partners** (partners.shopify.com)

If your app lives in a **Partner organization**, you can use automatic deploy on push:

1. **Partners** → **Settings** → **CLI token** → **Manage tokens** → **Generate token**. Copy the token.
2. **GitHub** → repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - Name: `SHOPIFY_CLI_PARTNERS_TOKEN`
   - Value: (paste the token)
3. Add a second secret so the workflow runs:
   - Name: `DEPLOY_PIXEL_VIA_CI`
   - Value: `true`
4. If `shopify.app.toml` has empty `client_id`, add secret `SHOPIFY_API_KEY` with your app’s Client ID.

Then every push to `main` will run the “Deploy to Shopify” workflow and deploy the pixel. If you do **not** set `DEPLOY_PIXEL_VIA_CI`, the workflow job is skipped (so no failed runs for Dev Dashboard apps).
