# Backups (non-runtime)

This folder is **not served** by the app. Static assets are served from `server/public/` only.

Contents may include:

- Historical SQLite DB backups (legacy). New backups are written to `KEXO_DATA_DIR/backups/` (default `~/.kexo/backups/`).
- Historical HTML/page snapshots under `public-pages/` (if present). These may contain **inline styles** and are kept for reference only; they are not part of the active UI contract.

Do not rely on this path for runtime behaviour.
