# Kexo agent rules

- **Commit + push** after every logical change group.
- **Deploy means push**: if the user asks to deploy, do not stop at committing—**push to `origin`** (normally `main`). Railway auto-deploys from git; **push to main is sufficient** (do **not** run `railway up` manually).
- **Push proof:** After each push run and paste output of:
  - `git rev-parse HEAD`
  - `git branch --show-current`
  - `git ls-remote --heads origin $(git branch --show-current)`  
  (remote ref must match HEAD.)
- Do **not** edit `server/public/app.js` directly; edit `client/app/**` and run `npm run build:app`.
- **No inline styles;** Tabler-first; follow [docs/UI_CONTRACT.md](docs/UI_CONTRACT.md).
- **Memory-safety:** single-init guards, cleanup timers/listeners/observers, avoid piling intervals, prefer `updateOptions`/`updateSeries` over destroy/recreate.
- No dead code; remove unused routes/files when replacing systems.
- No console spam in production (keep only logs that are clearly needed).
- Always list files to delete before deleting.
