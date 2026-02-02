# Sentry setup for Live Visitors app

This app uses a **separate Sentry project** from your theme so backend errors are easy to find. The setup follows Sentry’s recommended Express flow: **instrument.js** loads first and initializes Sentry; **Sentry.setupExpressErrorHandler(app)** is used after all routes.

---

## Step 1: Create a new Sentry project

1. In [Sentry](https://sentry.io), go to your organization and click **Create project** (or **Projects** → **Create Project**).
2. On **Step 1 – Choose your platform**:
   - Under **Popular** or **Server**, select **Node.js** or **Express**.
   - Click **Create project**.
3. On **Step 2 – Set your alert frequency**:
   - Choose e.g. **Alert me on high priority issues** (or **I'll create my own alerts later**).
   - Optionally enable **Notify via email** and **Connect to messaging** (Slack/Discord).
4. Click **Create project**. Sentry will show you the **DSN** (Client Key) on the next screen.

---

## Step 2: Copy the DSN

1. After the project is created, Sentry shows **Configure your application** with a code snippet.
2. Find the **DSN** – it looks like:
   ```text
   https://abc123@o123456.ingest.sentry.io/7654321
   ```
3. Copy the full DSN (you can also get it later from **Settings** → **Projects** → your project → **Client Keys (DSN)**).

---

## Step 3: Add the DSN to your app

1. **Local / `.env`**
   - In your project root, add to `.env`:
     ```env
     SENTRY_DSN=https://your-dsn@o123456.ingest.sentry.io/7654321
     ```
   - Replace with your real DSN.

2. **Railway (or other host)**
   - Open your **liveview** service → **Variables**.
   - Add:
     - **Variable:** `SENTRY_DSN`
     - **Value:** your DSN (same as above).
   - Redeploy so the new variable is picked up.

---

## Step 4: Confirm it’s working

1. Restart the app (or redeploy on Railway).
2. Open the Live Visitors dashboard → **Config status**.
   - You should see **Sentry** with a green check (configured).
3. Trigger a test error (e.g. hit a route that throws) or wait for a real error.
4. In Sentry → **Issues**, you should see the error with stack trace and request info.

---

## Verify with the test route

With `SENTRY_DSN` set, the app exposes a test route that throws an error so you can confirm Sentry receives it:

- **URL:** `GET /debug-sentry` (e.g. `https://your-app-url.com/debug-sentry`)
- The route throws **"My first Sentry error!"** and returns 500. The error should appear in Sentry → **Issues** within a few seconds.
- The route is only registered when `SENTRY_DSN` is set.

## What gets sent to Sentry

- **Unhandled errors** in the Node server (Express routes, migrations, cleanup job).
- **Request context** (URL, method, headers) for each error.
- **Environment** (`development` or `production` from `NODE_ENV`).

We use **sendDefaultPii: false** so IP and similar PII are not sent. No customer or visitor data is attached to Sentry events.

---

## Optional: same org as your theme

You can keep the theme project and this app project in the **same Sentry organization**. Use two projects:

- One for the **theme** (e.g. Browser JavaScript).
- One for **Live Visitors** (Node.js/Express).

That way you see backend errors in one project and frontend (theme) errors in the other.

---

## Turning Sentry off

- Remove `SENTRY_DSN` from `.env` and from Railway (or set it to empty).
- Restart/redeploy. The app will run normally; errors will only go to the server logs.
