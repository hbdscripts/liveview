## Kexo audit patch (Feb 25, 2026)

This patch fixes the 15 issues from the audit brief, with a focus on **fresh dashboards/KPIs** while eliminating **redundant resume bursts** and **unnecessary global listeners**.

---

## Changes per issue (1–15)

### 1) Critical vuln: `fast-xml-parser` (via `@aws-sdk/xml-builder`)
- **Fix**: Upgraded `@aws-sdk/client-s3` so the transitive chain no longer pulls a vulnerable `fast-xml-parser`.
- **Evidence**: `npm audit --omit=dev` is now clean.

### 2) High vuln: `minimatch`
- **Fix**:
  - Upgraded `@sentry/node` (which updated its `minimatch` chain).
  - Updated the remaining `glob -> minimatch` nested dependency to a patched version within semver range.
- **Evidence**: `npm audit --omit=dev` is now clean.

### 3) High vuln: `qs`
- **Fix**: Updated `qs` in the prod dependency tree to a patched version (via lockfile refresh within existing semver ranges).
- **Evidence**: `npm audit --omit=dev` is now clean.

### 4) Dependencies behind latest releases (`npm outdated`)
- **Fix**: Bumped the safe within-major updates:
  - `@aws-sdk/client-s3`, `@sentry/node`, `geoip-lite`, `openai`
- **Intentional deferrals (major upgrades)**:
  - `express@5`, `better-sqlite3@12`, `dotenv@17`, `jsdom@27` were **not** upgraded in this patch to avoid behavior/build regressions. These should be handled as a dedicated upgrade task with targeted testing.

### 5) Client code not linted (eslint ignored `client/**` + `extensions/`)
- **Fix**:
  - `eslint.config.js` no longer blanket-ignores `client/**` or `extensions/`.
  - Added `scripts/lint-client-app.js` to lint `client/app/*.js` **as a real bundle**, since those sources are build-time fragments (concatenated by `client/app/manifest.txt` into one IIFE).
  - Updated `npm run lint` so it **includes client + extensions** without parse errors.

### 6–9) Stale lint suppressions (unused `eslint-disable`)
- **Fix**: Removed unused directives from:
  - `scripts/lint-settings-ui.js`
  - `server/fraud/aiNarrative.js`
  - `server/routes/shopifyLeaderboard.js`
  - `server/runDailyBackup.js`

### 10) Production page knowingly “fake”: `server/public/upgrade.html`
- **Fix**:
  - Removed TODO-only behavior, `alert()`, and `console` logging.
  - Replaced “Choose plan” click flow with an honest “Billing not enabled in this build” info panel and non-JS links.

### 11) User-facing `alert()` in real UI flow: `server/public/attribution-tree-settings.js`
- **Fix**:
  - Replaced the blocking `alert()` on delete failure with a **non-blocking inline notice** rendered above the tree.
  - Failures are still observable via Sentry when available (`window.kexoSentry.captureException(...)`).

### 12) Duplicate tab-resume wiring (`visibilitychange`) across client modules
- **Fix**:
  - Added `client/app/00-lifecycle.js` as the **single global** lifecycle coordinator.
  - Removed module-level `document.addEventListener('visibilitychange', ...)` usage so only the lifecycle coordinator owns it.

### 13) Live-sales anonymous global listeners (no teardown)
- **Fix**:
  - Refactored resume handling in `client/app/13-live-sales.js` to subscribe via `window.kexoLifecycle.onResume(...)` (no per-module global listeners).
  - Kept behavior fail-open and lightweight (UI time signals + deploy drift/version check after meaningful idle).

### 14) Condensed KPI resume burst + anonymous listeners (no teardown)
- **Fix**:
  - Refactored `client/app/08-condensed-kpis.js` to use `kexoLifecycle` for resume/hidden.
  - **Resume burst reduced**:
    - Immediate resume refresh is **KPIs only**.
    - Heavier datasets/widgets are **deferred** and **deduped** (min idle + min interval + in-flight guard).

### 15) Map tooltip watcher binds permanent global listeners (no teardown)
- **Fix**: `client/app/07-type-pagination-watcher.js`
  - Global dismiss listeners are now only bound when map tooltips are active, and are registered with an `AbortController` for teardown.
  - Tooltip hide-on-hidden now uses `kexoLifecycle.onHidden(...)` (no extra `visibilitychange`).

---

## Supply-chain notes (SRI / CDNs)
- **Sentry browser bundle**: now SRI-pinned in `server/public/partials/head-theme.html`.
- **Tabler JS (upgrade page)**: now SRI-pinned in `server/public/upgrade.html`.
- **FontAwesome kit**: kits are generally **not reliably SRI-pinable** because the served content can change; kept as-is for now. Follow-up: migrate to self-hosted FontAwesome (or add CSP allowlisting) once icon-pack requirements are confirmed.

---

## Operational data location (SQLite + backups)
- Introduced `KEXO_DATA_DIR` (default `~/.kexo`) via `server/dataPaths.js`.
- SQLite default path is now `${KEXO_DATA_DIR}/live_visitors.sqlite`.
- SQLite backups now write to `${KEXO_DATA_DIR}/backups/`.
- Back-compat: if a legacy repo-root `./live_visitors.sqlite` exists and the new path doesn’t, the DB (and `-wal/-shm` when present) is copied once into the data dir on boot.

---

## Verification (quick)
- **Static checks**
  - `npm run build:app` ✅ (bundle regenerated; checksum test passes)
  - `npm run lint` (includes client bundle lint + extensions) ✅
  - `npm run ui:check` ✅
  - `npm run audit:prod` ✅
  - `npm test` ✅
- **Bundle-level assertions**
  - Built `server/public/app.js` contains **exactly one** `addEventListener('visibilitychange' …)` site (the lifecycle coordinator).
  - Built `server/public/app.js` contains **no** `alert(` usage.
- **Local smoke (non-interactive)**
  - Dev server boot logs include `[data] dir: ...` confirming SQLite/backups resolve under `KEXO_DATA_DIR` default.
  - `GET /upgrade` contains no `alert(` or `console.log` handlers.

