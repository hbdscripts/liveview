# App audit (bugs and fixes)

Audit date: 2026-02-08. Updated: 2026-02-08 (Tabler UI rollout, page split, routing updates).

## Summary

- UI rebuilt on Tabler and split into per-page HTML routes.
- Routing updated to serve `/dashboard`, `/live`, `/overview`, `/countries`, `/products`, `/traffic`, `/ads`, `/tools`.
- Root `/` now serves login and redirects to `/dashboard` when authenticated.
- Shared JS bundle (`server/public/app.js`) bootstraps per page via `data-page`.
- Tools page rebuilt with external `tools.css` styling.
- Sticky navbar overlap layout enabled via `server/public/tabler-theme.css`.

## Files touched (current release)

- `server/index.js`
- `server/middleware/dashboardAuth.js`
- `server/routes/login.js`
- `server/public/*.html` (new split pages)
- `server/public/app.js`
- `server/public/tabler-theme.css`
- `server/public/tools.css`
