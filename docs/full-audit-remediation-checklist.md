# Full Audit Remediation Checklist

Branch: `agent/2026-02-26-full-audit-remediation`

This checklist freezes the audit issue list and maps each finding to concrete code changes and validation.

## Critical / High

- [ ] H1/H2 `server/routes/auth.js`
  - Fix: enforce OAuth callback timestamp freshness and fail-closed token validation.
  - Validate: callback rejects stale timestamps; token probe failure does not pass as valid.
- [ ] H3 `server/routes/attribution.js`
  - Fix: remove implicit full-table delete when config lists are empty; require explicit clear semantics.
  - Validate: saving partial/empty payloads does not silently wipe unrelated config rows.
- [ ] H4 `server/public/ui/settings-ui.js`
  - Fix: remove raw `innerHTML` helper path (`el({ html })`) from shared Settings UI helper.
  - Validate: helper only supports text/attributes/nodes.
- [ ] H5/L25/L26 `server/public/kexo-table-builder.js`
  - Fix: harden settings table builder inputs and add `scope="col"` on emitted table headers.
  - Validate: dynamic table builders do not expose unsafe raw HTML injection and emit scoped headers.
- [ ] H6 `server/routes/verifySales.js` + store pixel query path
  - Fix: pass `shop` scope into pixel summary query for verify flow.
  - Validate: verify payload uses same shop scope for Shopify/truth/pixel values.
- [ ] H7 `server/migrate.js`
  - Fix: run each migration apply+mark atomically.
  - Validate: simulated migration failure does not leave partially-marked state.
- [ ] H8 `server/salesTruth.js` + `server/migrations/060_orders_shopify_refunds.js`
  - Fix: align schema/code so missing refund timestamp does not force silent row drop.
  - Validate: refunds with missing created timestamp are persisted with deterministic fallback.
- [ ] H9 `server/dataPaths.js`
  - Fix: guard legacy SQLite copy to avoid copying live WAL databases.
  - Validate: startup skips copy when `-wal` exists; performs copy only from clean legacy DB.

## Backend Medium

- [ ] M1 `server/routes/reconcileSales.js`
  - Fix: request range key drives returned health scope.
  - Validate: health scope equals requested range scope.
- [ ] M2 `server/routes/sessions.js`
  - Fix: strict `sessionId` format/length + pagination bounds validation.
  - Validate: invalid IDs/pagination return 400.
- [ ] M3 `server/routes/notifications.js`
  - Fix: reject PATCH payloads with no actionable fields.
  - Validate: empty/no-op payload returns 400.
- [ ] M4/M5 `server/cleanup.js`
  - Fix: set prune last-run stamp after successful delete and transaction-wrap coupled deletes.
  - Validate: forced error does not advance last-run stamp; no partial delete side effects.
- [ ] M8 `server/config.js` (+ retention consumers)
  - Fix: align `sessionRetentionDays` config semantics with runtime usage/deprecation.
  - Validate: configured session retention affects cleanup behavior deterministically.
- [ ] M6/M7 `server/db.js`
  - Fix: correct Postgres `lastID` contract and safe placeholder translation.
  - Validate: non-returning statements do not report fake IDs; SQL literal `?` remains intact.
- [ ] M10 `server/usersService.js`
  - Fix: deny path clears `approved_at` explicitly.
  - Validate: denied users have `approved_at = NULL`.
- [ ] M30 `server/routes/adminUsers.js` + `server/public/admin-page.js`
  - Fix: block admin actions on synthetic Shopify IDs and surface explicit UX guardrails.
  - Validate: synthetic IDs are non-actionable in UI and rejected server-side.
- [ ] M28 `server/routes/costBreakdown.js`
  - Fix: capture/log swallowed errors with structured context.
  - Validate: failures emit structured logs/Sentry breadcrumbs.

## Frontend Medium

- [ ] M16 `client/app/21-notifications-offcanvas.js`
  - Fix: request token/abort guard against stale detail race.
  - Validate: rapid row changes never render stale detail payload.
- [ ] M17/M18 `client/app/23-insights-deep-pages.js`
  - Fix: in-flight cancellation and strict `r.ok` handling before parse.
  - Validate: repeated loads ignore stale responses and error paths remain stable.
- [ ] M14/M15 `client/app/07-type-pagination-watcher.js`
  - Fix: unify VPV denominator/source and table visibility gates.
  - Validate: sort metric matches displayed metric and visibility rules.
- [ ] M19/M20 `client/app/03-grid-drag-table.js`
  - Fix: disconnect observers/listeners for detached nodes.
  - Validate: repeated mount/unmount does not leak observers.
- [ ] M21 `client/app/08-condensed-kpis.js`
  - Fix: remove `orientationchange` listener during cleanup.
  - Validate: no duplicate orientation listeners after re-init.
- [ ] M22 `client/app/13-live-sales.js` (+ load-order guard in related module)
  - Fix: guard external poll scheduler dependency.
  - Validate: module works regardless of script load order.
- [ ] `client/app/06-products-dropdowns.js`
  - Fix: add load-order/runtime guards from audit plan.
  - Validate: no hard errors when dependent globals are not yet ready.

## Table Semantics + Settings/Admin UI Contract

- [ ] L1-L23, L25-L26 table header scope coverage
  - Target files:
    - `server/public/kexo-table-builder.js`
    - `server/public/settings.html`
    - `server/public/dashboard/overview.html`
    - `server/public/insights/snapshot.html`
    - `server/public/attribution-mapping-settings.js`
    - `server/public/ads.js`
    - `server/public/tools-change-pins.js`
    - `server/public/tools-time-of-day.js`
    - `server/public/performance.html`
    - `server/public/settings-page.js`
  - Fix: all `<th>` include `scope="col"` where appropriate.
  - Validate: table-header scope audit returns zero findings for maintained sources.
- [ ] M25/L27 `server/public/attribution-mapping-settings.js`
  - Fix: read-only token inputs use `form-control-plaintext` and remove inline style drifts.
  - Validate: field is visibly read-only and Settings contract checks pass.
- [ ] M26 `server/public/ui/settings-normaliser.js`
  - Fix: enforce canonical button classes (no outline/secondary drift).
  - Validate: `npm run ui:check` + settings layout test pass.
- [ ] M23/M24 `server/public/attribution-tree-settings.js`
  - Fix: remove stray `?` prefix and `Saving?` typo.
  - Validate: copy reads correctly in modal/status UI.
- [ ] M27 `server/public/dashboard/overview.html`
  - Fix: merge duplicate `class` attribute.
  - Validate: valid markup and expected icon classes preserved.

## Validation Gates

- [ ] `npm run lint`
- [ ] `npm run ui:check`
- [ ] `npm test`
- [ ] `npm run build:app` (required for `client/app/**` changes)

## Landing

- [ ] Stage commits on topic branch
- [ ] Rebase branch on `origin/main`
- [ ] Merge to `main` and push
- [ ] Push proof:
  - `git rev-parse HEAD`
  - `git branch --show-current`
  - `git ls-remote --heads origin $(git branch --show-current)`
- [ ] Update `HANDOVER.md`
