# Kexo agent rules

- **Commit often. Push safely.** Commit after every logical change group on a topic branch.
- **Always deploy.** Once the task is complete, land the work on `main` and push `main` so Railway auto-deploys.
  - Do **not** ask for deploy confirmation unless the user has explicitly said “don’t deploy”.
  - If there are **no code changes**, do not create empty commits/pushes.
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

---

## Multi-agent / parallel work safety (required)

When multiple agents (or humans) may touch the repo at the same time, follow this to avoid clobbering each other.

- **Branch-by-default**: create a topic branch for each task (e.g. `agent/2026-02-18-settings-mobile-menu`).
  - **Always deploy** at the end of the task by landing on `main` and pushing `main`.
  - If `origin/main` moved while you were working, **rebase your branch** and resolve conflicts before landing.
- **Sync before work and before commit**:
  - Run `git fetch origin` at the start of the task.
  - If `origin/main` moved since you started, rebase your branch on top (and re-run required builds like `npm run build:app`).
- **Never discard unknown edits**:
  - Do not run `git restore .`, `git checkout -- .`, `git reset --hard`, or similar “wipe” commands unless you are **certain** you are discarding only your own local changes.
  - If the working tree changes unexpectedly: stop, inspect `git status` + `git diff`, and prefer `git stash -u` to preserve work while investigating.
- **Handover discipline**:
  - If you touched core paths (routes/auth/dashboard UX/ingest/schema/deploy), update `HANDOVER.md` in the same commit.
  - When pausing, leave a short note in `HANDOVER.md` describing the branch, what changed, and next steps.
