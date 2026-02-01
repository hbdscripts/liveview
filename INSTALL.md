# Live Visitors – Step-by-step install guide

This guide walks you through installing the Live Visitors app in Shopify from scratch: preparing files, creating the app, finding every value, deploying, and verifying.

---

## Part 1: Prepare the project (do this first)

### Step 1.1 – Install dependencies

In the project folder:

```bash
npm install
```

### Step 1.2 – Create your `.env` file

1. Copy the example env file:
   ```bash
   cp .env.example .env
   ```
   (On Windows: `copy .env.example .env`.)

2. Open `.env` in a text editor. You will fill in values in later steps. For now you can leave everything as-is or set only what’s below.

### Step 1.3 – Generate the ingest secret (do this now)

1. In the project folder run:
   ```bash
   node scripts/generate-ingest-secret.js
   ```
2. The script prints a long random string (e.g. `a1b2c3d4e5...`).
3. Open `.env` and find the line `INGEST_SECRET=`.
4. Paste that string after the `=` with no spaces:
   ```env
   INGEST_SECRET=a1b2c3d4e5f6...paste_the_whole_output_here
   ```
5. Save `.env`. You will use this same value again when configuring the pixel (Step 4).

**Why:** The pixel sends events to your server. The server only accepts requests that include this secret in the header, so only your pixel can send data.

### Step 1.4 – Run database migrations

```bash
npm run migrate
```

You should see: `Migrations complete.`  
This creates the SQLite database file (e.g. `live_visitors.sqlite`) in the project folder.

### Step 1.5 – (Optional) Test locally before Shopify

1. Start the server:
   ```bash
   npm run dev
   ```
2. Open in your browser: **http://localhost:3000/app/live-visitors**
3. You should see the dashboard (empty table and config status).  
4. Stop the server when done (Ctrl+C).

You can come back and run `npm run dev` anytime to work against your local backend.

---

## Part 2: Create the app in Shopify

**Build and manage apps in your Dev Dashboard.** The Dev Dashboard is your app development home, with more capabilities and tools than legacy custom apps.

**Using Shopify CLI from this repo:** Yes — you can run Shopify CLI **here** to link this project to an app and deploy (install the app and pixel to Shopify). See the section **“Yes – you can run Shopify CLI here and install this app”** below.

> **Legacy custom apps:** As of January 1, 2026, you can no longer create *new* legacy custom apps. This does not impact any existing apps you already have. For new apps, use the Dev Dashboard (below).

---

### How do I find the Client ID (SHOPIFY_API_KEY)?

1. Go to **https://partners.shopify.com** and log in.
2. In the left sidebar click **Apps** (or **Build** → Apps).
3. Click your app (e.g. **Live Visitors**). If you haven’t created one yet, click **Create app** → **Create app manually** and name it, then open it.
4. In the app, go to **App setup** (or **Configuration** or **API credentials**).
5. Under **Client credentials** (or **API credentials**) you’ll see:
   - **Client ID** — a long string like `a1b2c3d4e5f6789...`. Copy this. **This is your SHOPIFY_API_KEY.** Paste it into `.env` as `SHOPIFY_API_KEY=...`
   - **Client secret** — click **Reveal** or **Show**, then copy. Put it in `.env` as `SHOPIFY_API_SECRET=...`

Save `.env`. You can then run `npm run config:link` from this repo (it uses `SHOPIFY_API_KEY` from `.env`).

---

### "Create an app" from the Dev Dashboard – use this repo, not the CLI template

When you click **Create an app** in the Dev Dashboard, you may see:

- **Start with Shopify CLI** — with:
  ```bash
  npm init @shopify/app@latest
  ```
  That command **creates a brand-new app** from Shopify’s template (Remix/Node, etc.). It does **not** install or use this Live Visitors project. If you run it, you get a fresh scaffold; you would have to copy or port the Live Visitors code into it.

**To use this Live Visitors app:**

1. **Create an app manually** in the Dev Dashboard (see Step 2.1–2.2 below) — choose **Create app manually** (or **Build an app** / **Create app** without choosing “Start with Shopify CLI”). That gives you an app and a Client ID.
2. Use **this repo** in a folder on your machine: clone or download it, then follow Part 1 (prepare project, `.env`, migrate) and Part 3 (deploy backend).
3. **Optional – link this project to your app with Shopify CLI:**  
   If you have the [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) installed, from this project folder run:
   ```bash
   npm run config:link
   ```
   (or `npx shopify app config link`). When prompted, choose your app or enter your Client ID. After that you can run `npm run deploy` (or `shopify app deploy`) from this repo to deploy the Web Pixel extension. The backend (Node server) is still deployed separately (e.g. Railway, Fly.io) — the CLI deploys the extension to Shopify.

So: **do not** run `npm init @shopify/app@latest` for this app. Create the app manually in the Dev Dashboard and use this repo.

---

### Yes – you can run Shopify CLI here and install this app

If **Shopify CLI is installed** in this environment, you can do almost everything from **this project folder**:

1. **Create the app once in the Dev Dashboard** (Step 2.1–2.3 below) so you have an app and a **Client ID**. You only do this once.
2. **From this repo:** open a terminal in the project folder and run:
   ```bash
   shopify app config link
   ```
   (or `npm run config:link`). When prompted, choose your app or paste your Client ID. That links this project to your app.
3. **From this repo:** deploy the app and Web Pixel extension to Shopify:
   ```bash
   shopify app deploy
   ```
   (or `npm run deploy`). That pushes the app config and the Live Visitors pixel to Shopify — that’s “installing” the app to Shopify.
4. **Install the app on a store:** In the Dev Dashboard, open your app → **Distribution** / **Test your app** → select a store → **Install app**. Or use any install link Shopify shows after deploy.

The **Node backend** (dashboard, ingest API) runs separately: either `npm run dev` locally or deploy it to Railway / Fly.io / your server and set `SHOPIFY_APP_URL` in the Dev Dashboard to that URL.

**Automated from this repo (like theme check):** Scripts run Shopify CLI directly using your `.env`. Run `npm run config:link` (uses `SHOPIFY_API_KEY`, no prompt) then `npm run deploy` (deploys with `--allow-updates`). Log in once with `shopify auth login` if needed. See the table in the section above for all commands.

---

### Step 2.1 – Open the Dev Dashboard

1. Go to **https://partners.shopify.com**
2. Log in (or create a Partner account).
3. If you don’t have a development store, create one: **Stores → Add store → Create development store**.

### Step 2.2 – Create an app (manually)

1. In the Dev Dashboard, go to **Apps** (or **Build** → Apps).
2. Click **Create an app**.
3. If you see **Start with Shopify CLI** and `npm init @shopify/app@latest`, **do not** use that for this project. Choose **Create app manually** (or **Build an app** / the option that does not use the CLI template).
4. Give the app a name, e.g. **Live Visitors**.
5. Click **Create app**.

### Step 2.3 – Get Client ID and Client secret

1. Open your app in the Dev Dashboard.
2. Go to **App setup** (or **Configuration** / **API credentials**).
3. Find **Client credentials** (or **API credentials**).
4. Copy **Client ID** (long string like `a1b2c3d4e5f6...`).  
   → This is your **SHOPIFY_API_KEY**.
5. Click **Reveal** or **Show** next to **Client secret** and copy it.  
   → This is your **SHOPIFY_API_SECRET**.

**Where to put them:**  
Open `.env` and set (use your real values, no quotes):

```env
SHOPIFY_API_KEY=paste_client_id_here
SHOPIFY_API_SECRET=paste_client_secret_here
```

Save `.env`.

### Step 2.4 – App URL and redirect URLs (after you have a URL)

You need a **public URL** where your app backend will run (e.g. `https://your-app.example.com` or a tunnel URL). If you don’t have one yet:

- **Option 1 – Deploy first:** Deploy the backend (Part 3), get the URL, then come back and do Step 2.4 and 2.5.
- **Option 2 – Local tunnel:** Use a tunnel (e.g. ngrok, Cloudflare Tunnel) so `https://something.ngrok.io` points to `http://localhost:3000`, then use that as your app URL.

When you have the URL (e.g. `https://your-app.example.com`):

1. In the Dev Dashboard, open your app → **App setup** (or **Configuration**).
2. Find **App URL** and set it to your app root, **with no trailing slash**:
   - Example: `https://your-app.example.com`
3. Find **Allowed redirection URL(s)** and add these two (replace with your URL):
   - `https://your-app.example.com/auth/callback`
   - `https://your-app.example.com/auth/shopify/callback`
4. Save.

In `.env` set:

```env
SHOPIFY_APP_URL=https://your-app.example.com
```

Save `.env`.

---

---

#### Step 2.B.2 – Create a custom app

1. Go to **Settings** (bottom left) → **Apps and sales channels**.
2. Click **Develop apps** (or **Develop apps for your store**).  
   If you see “Develop apps” is disabled, enable **Allow custom app development** in store settings first.
3. Click **Create an app** → **Create app manually**.
4. Name it (e.g. **Live Visitors**) and click **Create app**.

#### Step 2.B.3 – Get Client ID and Client secret

1. Open the app you just created.
2. Go to **Configuration** (or **API credentials**).
3. Copy **Client ID** → use as **SHOPIFY_API_KEY** in `.env`.
4. Click **Reveal** next to **Client secret** and copy → use as **SHOPIFY_API_SECRET** in `.env`.

In `.env`:

```env
SHOPIFY_API_KEY=paste_client_id_here
SHOPIFY_API_SECRET=paste_client_secret_here
```

#### Step 2.B.4 – App URL and redirect URLs

Same idea as Path A: you need a public URL. When you have it (e.g. after Part 3):

1. In the custom app → **Configuration**.
2. Set **App URL** to your app root (e.g. `https://your-app.example.com`).
3. Under **Allowed redirection URL(s)** add:
   - `https://your-app.example.com/auth/callback`
   - `https://your-app.example.com/auth/shopify/callback`
4. Save.

In `.env`:

```env
SHOPIFY_APP_URL=https://your-app.example.com
```

---

### Step 2.5 – Scopes (both paths)

1. In the app configuration (Partners or Custom app), find **API access** or **Scopes**.
2. Request at least: **read_products**, **read_orders** (or the scopes your app needs).
3. In `.env` (optional; defaults are already set):
   ```env
   SHOPIFY_SCOPES=read_products,read_orders
   ```

---

### Step 2.6 – Update `shopify.app.toml` (if you use Shopify CLI)

1. Open **shopify.app.toml** in the project root.
2. Set `client_id` to your **Client ID** (same as `SHOPIFY_API_KEY`):
   ```toml
   client_id = "paste_your_client_id_here"
   ```
3. Set `application_url` and the URLs under `[auth]` to match your app URL (same as `SHOPIFY_APP_URL` and the two redirect URLs above).

Save the file.

---

## Part 3: Deploy (or expose) your backend

### Do I need a server?

**Yes.** The app we built has a **Node backend** that must be running somewhere so that:

1. **The pixel** can send events to `POST /api/ingest` (your storefront talks to this URL).
2. **The admin dashboard** can load at `https://your-app-url/app/live-visitors` and call the API (sessions, SSE, settings).
3. **The database** (SQLite or Postgres) can store visitors, sessions, and events.

You don’t need a dedicated physical server. You can:

- **Run it on your machine** with `npm run dev` and use a **tunnel** (e.g. ngrok, Cloudflare Tunnel) so the pixel and Shopify can reach it at a public URL, or  
- **Deploy it to a host** (Railway, Fly.io, Heroku, a VPS, etc.) so it runs 24/7 at a URL you set as `SHOPIFY_APP_URL`.

The **Web Pixel** is deployed to Shopify via `npm run deploy`; it doesn’t run on your server. Only the Node app (ingest API, dashboard, DB) needs to run on a server or a hosted platform.

---

Your store and the pixel need to reach your app at a **public HTTPS URL**. Choose one of these.

### Option 3a – Deploy to a host (Railway, Fly.io, Heroku, etc.)

1. Create an account on the host (e.g. [Railway](https://railway.app), [Fly.io](https://fly.io)).
2. Create a new project/app and connect this repo (or upload the project).
3. Set **environment variables** from your `.env`:
   - At minimum: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `INGEST_SECRET`
   - Optionally: `DB_URL` (for Postgres), `PORT` (if required by the host).
4. Set the start command to: `npm run migrate && npm start` (or `node server/index.js`) if the host doesn’t run migrations automatically.
5. Deploy. The host will give you a URL, e.g. `https://your-app.up.railway.app`.
6. Use that URL as **SHOPIFY_APP_URL** everywhere (and in Step 2.4 if you hadn’t set it yet). Update `.env` and `shopify.app.toml` if needed.

### Option 3b – Run on your own server (VPS, etc.)

1. Copy the project to the server.
2. Install Node.js 18+.
3. Create a `.env` file with the same variables as above.
4. Run `npm install`, then `npm run migrate`, then start the app (e.g. with `pm2` or systemd). Expose it via Nginx/Apache with HTTPS.
5. Your app URL is whatever you use in the browser (e.g. `https://livevisitors.yourdomain.com`).

### Option 3c – Local development with a tunnel

1. Run the app locally: `npm run dev`.
2. Start a tunnel (e.g. ngrok: `ngrok http 3000`).
3. Copy the HTTPS URL ngrok shows (e.g. `https://abc123.ngrok.io`).
4. Use that as **SHOPIFY_APP_URL** in `.env` and in Shopify app configuration (App URL and redirect URLs).  
   Note: Tunnel URLs change when you restart ngrok unless you use a paid plan.

---

After Part 3 you must have:

- A **public HTTPS URL** for your app (e.g. `https://your-app.example.com`).
- **SHOPIFY_APP_URL** in `.env` set to that URL (no trailing slash).
- In the Dev Dashboard (your app config), **App URL** and **Allowed redirection URL(s)** set to that same base URL and the two callback URLs.

---

## Part 4: Configure the Web Pixel extension

The pixel runs on your storefront and sends events to your backend. It needs the **ingest URL** and the **ingest secret** (same as in `.env`).

### Step 4.1 – Where to configure the pixel

- In the **Dev Dashboard**, open your app → **Extensions** (or **App setup** → Extensions). Find the **Live Visitors** (or Web Pixel) extension.
- After the app is installed on a store, you can also reach extensions from the store’s **Settings → Apps and sales channels** → your app → **Extensions**.

If the extension isn’t there yet, you may need to deploy it first (see Step 4.3).

### Step 4.2 – Set Ingest URL and Ingest Secret

1. Open the pixel extension **settings** (or **Configuration**).
2. Find the two fields (names may vary):
   - **Ingest URL** (or “Full URL to POST events”)
   - **Ingest Secret** (or “Secret for X-Ingest-Secret header”)
3. Set **Ingest URL** to:
   ```text
   https://YOUR_APP_URL/api/ingest
   ```
   Replace `YOUR_APP_URL` with your real app URL (same as `SHOPIFY_APP_URL`), e.g.:
   ```text
   https://your-app.up.railway.app/api/ingest
   ```
4. Set **Ingest Secret** to the **exact same value** you put in `.env` as `INGEST_SECRET` (the one from `node scripts/generate-ingest-secret.js`).
5. Save.

### Step 4.3 – Deploy the extension (if you use Shopify CLI)

If you use `shopify app deploy`:

1. In the project folder, ensure `shopify.app.toml` has the correct `client_id` and URLs.
2. Run:
   ```bash
   shopify app deploy
   ```
3. Follow the prompts. This deploys the app and the Web Pixel extension so it appears in your app in the Dev Dashboard and on the store.

If you don’t use the CLI, the pixel may be configured and enabled when you install the app (depending on how the app is packaged).

---

## Part 5: Install the app on your store

1. In the **Dev Dashboard**, open your app.
2. Go to **Distribution** or **Test your app** (or the equivalent for installing on a store).
3. Click **Select store** and choose your development or production store.
4. Click **Install app** (or **Test on development store**). You may be asked to approve the requested scopes.
5. After install, you’ll be redirected. The redirect might go to your **App URL** (your backend). If your backend doesn’t implement Shopify OAuth yet, you can still open the dashboard by going directly to:
   ```text
   https://YOUR_APP_URL/app/live-visitors
   ```
   (Replace with your real app URL.)

---

## Part 6: Verify it works

### Step 6.1 – Open the dashboard

1. Go to **https://YOUR_APP_URL/app/live-visitors** (use your real app URL).
2. You should see:
   - Config status (e.g. Shopify API, App URL, Ingest secret – as ✅/❌, no secrets shown).
   - KPIs (Active now, Abandoned).
   - Tabs: Active, Recent, Abandoned, All.
   - An empty table at first.

### Step 6.2 – Generate a visit

1. Open your **storefront** in another tab (e.g. `https://your-store.myshopify.com` or your custom domain).
2. Browse a few pages (home, a product).
3. Wait up to ~30 seconds (heartbeat interval).
4. Refresh or wait for the dashboard to update. You should see **at least one row** in the Active tab (visitor, page/product, time on site, etc.).

### Step 6.3 – Test cart and checkout

- **Add to cart:** Add a product to the cart on the storefront. The dashboard row’s **Cart** column should update.
- **Checkout:** Start checkout (don’t need to pay). The row should show the **Checking out** chip for a while.
- **Abandoned:** Leave the store with items in the cart and don’t send events for the configured abandonment window. The session can later appear under the **Abandoned** tab.

If something doesn’t work, see **Troubleshooting** below.

---

## Part 7: Quick reference – where you set what

| What you need           | Where you get it / set it |
|-------------------------|---------------------------|
| **INGEST_SECRET**       | Generate: `node scripts/generate-ingest-secret.js`. Put in `.env` and in pixel extension **Ingest Secret**. |
| **SHOPIFY_API_KEY**      | Dev Dashboard: Your app → App setup / Configuration → **Client ID**. Put in `.env`. |
| **SHOPIFY_API_SECRET**   | Dev Dashboard: Your app → App setup / Configuration → **Client secret** (Reveal). Put in `.env`. |
| **SHOPIFY_APP_URL**      | Your deployed app root URL (e.g. `https://your-app.up.railway.app`). Put in `.env` and in Dev Dashboard app **App URL**. |
| **Redirect URLs**        | In Dev Dashboard app config: `https://YOUR_APP_URL/auth/callback` and `https://YOUR_APP_URL/auth/shopify/callback`. |
| **Pixel Ingest URL**     | Pixel extension settings: `https://YOUR_APP_URL/api/ingest`. |
| **Pixel Ingest Secret**  | Same value as `INGEST_SECRET` in `.env`. |

---

## Troubleshooting

- **Config status shows ❌ for Ingest secret**  
  Make sure `.env` has `INGEST_SECRET=your_long_secret` (no quotes, no spaces). Restart the server after changing `.env`.

- **No rows in the dashboard**  
  - Check that **Ingest URL** and **Ingest Secret** in the pixel extension match your backend URL and `.env` `INGEST_SECRET`.  
  - Browse the storefront (different browser or incognito can help).  
  - Ensure **Tracking** is ON in the dashboard (toggle button).  
  - Check the backend logs for 401/403 on `/api/ingest` (wrong secret) or 4xx (validation errors).

- **Pixel not loading / no events**  
  - Ensure the pixel extension is **deployed** and **enabled** for the store.  
  - In the extension’s `shopify.extension.toml`, `customer_privacy` should have analytics/marketing/preferences false and sale_of_data disabled so the pixel can run without consent.

- **Redirect or “couldn’t load app”**  
  - **App URL** and **Allowed redirection URL(s)** in Shopify must exactly match your app (same scheme, host, no trailing slash on App URL).  
  - If you use a tunnel, the URL must be the same in Shopify and in `SHOPIFY_APP_URL`.

- **Dashboard works but I never went through OAuth**  
  This app can run in a “limited” mode where the dashboard and ingest work without Shopify session. For full embedded admin inside Shopify, you’d add OAuth and session handling; the dashboard URL is still `https://YOUR_APP_URL/app/live-visitors`.

---

## Summary checklist

- [ ] `.env` created from `.env.example`
- [ ] `INGEST_SECRET` generated and set in `.env`
- [ ] `npm run migrate` run successfully
- [ ] App created in Shopify (Dev Dashboard)
- [ ] `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` in `.env`
- [ ] Backend deployed or exposed at a public HTTPS URL
- [ ] `SHOPIFY_APP_URL` in `.env` = that URL
- [ ] In Shopify app config: App URL and both redirect URLs set
- [ ] Pixel extension: Ingest URL = `https://YOUR_APP_URL/api/ingest`, Ingest Secret = `INGEST_SECRET` value
- [ ] App installed on the store
- [ ] Dashboard opens at `https://YOUR_APP_URL/app/live-visitors`
- [ ] Browsing the storefront creates at least one row in the dashboard
