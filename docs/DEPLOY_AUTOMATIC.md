# Deploy: backend vs pixel

**This project is a developer app** (Dev Dashboard, dev.shopify.com), not a Partner organization app. The pixel is deployed manually with `npm run deploy`; the GitHub “Deploy to Shopify” workflow is for Partner apps only and is skipped unless you set `DEPLOY_PIXEL_VIA_CI=true` and use a Partner token.

## Backend (Railway) – automatic on push

**The live dashboard UI is served by Railway, not by GitHub.** GitHub CI (the “build” check) only verifies that the code installs and migrations run; it does **not** deploy your app. To see updated UI: (1) ensure Railway has deployed the latest commit (Railway → Deployments → check the commit SHA), and (2) hard-refresh the dashboard (Ctrl+Shift+R or incognito).

When you push to `main`, **Railway** deploys the backend (if the repo is connected to Railway). No extra setup.

### Railway settings checklist (auto-deploy)

In [Railway](https://railway.app) → your project → **your service** (the one that serves the app):

| Where | What to check |
|-------|----------------|
| **Settings → Source** | **Connect repo**: GitHub repo is connected (e.g. `hbdscripts/liveview`). **Branch**: set to `main` (or the branch you push to). **Auto-deploy**: usually “Deploy on push” or “Watch Paths” — ensure new commits trigger a deploy. |
| **Settings → Build** | **Build command**: leave default (Railway/Nixpacks will run `npm install` and use `npm start`) or set `npm ci` / `npm run migrate && npm start` if you run migrations on deploy. **Root directory**: leave blank unless the app lives in a subfolder. **Start command**: `npm start` (uses `package.json` scripts.start). |
| **Settings → Deploy** | **Restart policy**: “On failure” or “Always” as you prefer. No need to change unless you want different behavior. |
| **Variables** | Required env vars (e.g. `DATABASE_URL`, `INGEST_SECRET`, `SHOPIFY_*`, `DASHBOARD_SECRET`, etc.) are set on **this service** (not only in Shared Variables if your project uses them — service-level vars override). |
| **Deployments** | After a push, a new deployment should appear within a minute or two. Open the latest deployment and confirm the **commit** (or commit SHA) matches the latest commit on `main` on GitHub. |

If **Source** shows the correct repo and branch and “Deploy on push” (or equivalent) is on, pushes to `main` should trigger a new build and deploy automatically. If deploys don’t start, use **Deployments → Redeploy** once, then push again and watch **Deployments** for a new run.

### Live URL not showing latest changes (no login, iframe still broken)

Railway runs the code that was **in Git at the time of the last deploy**. If you see no login page and no iframe fix:

1. **Push your latest code to the branch Railway uses** (usually `main`):
   - Commit: `git add -A && git status` then `git commit -m "Add login and iframe fix"`
   - Push: `git push origin main`
2. **Confirm Railway is connected to this repo and branch**  
   In Railway: Project → your service → **Settings** → **Source** (e.g. GitHub `hbdscripts/liveview`, branch `main`).
3. **Trigger a deploy**  
   After a push, Railway usually auto-deploys. If not: Railway → **Deployments** → **Redeploy** (or push an empty commit: `git commit --allow-empty -m "Trigger deploy" && git push origin main`).
4. **Check the latest deployment**  
   Railway → **Deployments** → open the latest run and confirm the **commit SHA** matches GitHub’s latest commit on `main`.
5. **Bypass cache**  
   Hard refresh (Ctrl+Shift+R / Cmd+Shift+R) or open the URL in a private/incognito window. The dashboard HTML is sent with `Cache-Control: no-store` so after a redeploy a hard refresh will always load the new version.

After a successful deploy, visiting `https://liveview-production.up.railway.app/app/live-visitors` directly should **redirect to `/app/login`** and show the sign-in options (Google / Shopify / secret). Opening the app from Shopify admin (correct referer) can load the dashboard without the splash.

---

## Pixel (Shopify) – developer app

### Do I need to manually add the pixel? Is it in my site’s source code?

**No.** The Live Visitors pixel is a **Web Pixel app extension**. You do **not** add it to your theme or site source code, and you do **not** use “Add custom pixel” in Customer events. When you deploy the extension (`npm run deploy`) and the app is installed on the store, Shopify runs the pixel on the storefront automatically. You only need to set **Ingest URL** and **Ingest Secret** in the app’s extension settings (Dev Dashboard → your app → Extensions → Live Visitors pixel → Configuration).

### Deploying the pixel (developer app)

Deploy the pixel **manually** when you change it:

1. Open your project in a terminal (repo root).
2. Log in to the account that owns the app (if needed):  
   `shopify auth login`
3. Deploy:  
   `npm run deploy`  
   (or `shopify app deploy --allow-updates`)
4. Follow the prompts.

After that, the Web Pixel is updated on Shopify. Run it again whenever you change the pixel or app config.

Then set the pixel’s **Ingest URL** and **Ingest Secret** via the GraphQL Admin API (there is no “Extensions → Configuration” screen in Dev Dashboard). Run `node scripts/configure-pixel.js` and run the printed mutation in GraphiQL when using `shopify app dev`. See [docs/PIXEL_CONFIG.md](PIXEL_CONFIG.md).

---

### If you were using a Partner app (partners.shopify.com)

If your app lives in a **Partner organization**, you can use automatic deploy on push:

1. **Partners** → **Settings** → **CLI token** → **Manage tokens** → **Generate token**. Copy the token.
2. **GitHub** → repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - Name: `SHOPIFY_CLI_PARTNERS_TOKEN`
   - Value: (paste the token)
3. Add a second secret so the workflow runs:
   - Name: `DEPLOY_PIXEL_VIA_CI`
   - Value: `true`
4. If `shopify.app.toml` has empty `client_id`, add secret `SHOPIFY_API_KEY` with your app’s Client ID.

Then every push to `main` would run the “Deploy to Shopify” workflow. For this project (developer app), leave `DEPLOY_PIXEL_VIA_CI` unset and deploy the pixel manually.

### "Deploy to Shopify" workflow errors

- **"The job was not acquired by Runner of type hosted even after multiple attempts"**  
  GitHub could not assign a hosted runner (capacity/queue). **Fix:** Re-run the workflow from the repo **Actions** tab (Re-run all jobs), or wait and push again. If it keeps failing, deploy the pixel locally: `npm run deploy`.

- **"Internal server error" (Correlation ID: ...)**  
  Can be from GitHub (runner allocation) or from Shopify's API during `shopify app deploy`. **Fix:** Re-run the workflow once or twice. The workflow now retries the deploy step up to 3 times with a 30s delay. If it still fails, deploy locally: `npm run deploy`.
