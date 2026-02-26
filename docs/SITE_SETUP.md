# Site project setup (for colleague building kexo.io/site)

This doc is for whoever is building the new front-end at **kexo.io/site**. It explains how to use Git and Cursor so your work stays in the `site/` folder and does not affect the main Kexo app (dashboard, API, ingest, etc.).

## How it works

- The new site is served at **https://kexo.io/site** (and **/site/**).
- All your code lives in the **`site/`** folder at the repo root. No other folders.
- The main app (dashboard, settings, API) is unchanged; your commits only touch `site/`.
- **robots.txt** blocks `/site` and `/site/` while the site is in development, so search engines won’t index it until you’re ready.

## Git workflow

### 1. Clone and branch

```bash
git clone <repo-url> KEXO
cd KEXO
git fetch origin
git checkout -b feature/site origin/main
```

Use a dedicated branch (e.g. `feature/site` or `site`). You can push this branch and open PRs from it; merging to `main` will only add/change files under `site/`, so the rest of the app is unaffected.

### 2. Work only in `site/`

- Add and edit files **only under the `site/` folder** (e.g. `site/index.html`, `site/css/`, `site/js/`, etc.).
- Do not change `server/`, `client/`, `docs/` (except this doc if needed), or root config files, unless you’ve agreed with the team.

### 3. Commits and pushes

- Commit often on your branch:
  ```bash
  git add site/
  git status   # double-check only site/ is staged
  git commit -m "Site: ..."
  git push origin feature/site
  ```
- Your pushes go to the **branch** (e.g. `feature/site`), not straight to `main`. The main app is only updated when someone merges that branch into `main`, and the only diff will be under `site/`.

### 4. When the site is ready for production

- Merge `feature/site` into `main` (e.g. via PR). Only `site/` (and any docs you changed) will be in the merge.
- Remove the **robots.txt** block for `/site` when you want the site indexed: edit **server/public/robots.txt** and delete the two lines:
  - `Disallow: /site`
  - `Disallow: /site/`

## Cursor setup (so changes don’t affect the rest of the app)

1. **Open the repo in Cursor**  
   File → Open Folder → select the KEXO repo (the folder that contains `site/`, `server/`, `client/`, etc.).

2. **Stay in the `site/` folder in the file tree**  
   Work and create new files under `site/`. The app (server, dashboard) lives in `server/`, `client/`, etc.; leave those alone unless you’re asked to change them.

3. **Optional: Cursor rule scoped to `site/`**  
   To remind yourself (or the AI) to only edit the site, you can add a rule that applies when working in `site/`:
   - In **.cursor/rules/** create a file (e.g. `site-only.mdc`) that says: when editing or creating files for the kexo.io/site project, only create or modify files under the **site/** directory; do not change server, client, or other app code.
   - That way Cursor suggestions stay scoped to the site.

4. **No subdomain needed**  
   The main app stays on the same domain (e.g. kexo.io). The new site is just a path: **kexo.io/site**. So there’s nothing special to configure for subdomains; your changes only affect what’s served under `/site`.

## Summary

| Goal | How |
|------|-----|
| Your changes don’t affect the main app | Work only in `site/` and use a branch (e.g. `feature/site`). |
| Pushes/commits go “into” kexo.io/site | All your files are under `site/`; the server serves that folder at `/site`. |
| Site not indexed while building | `server/public/robots.txt` has `Disallow: /site` and `Disallow: /site/` until you remove them. |
| Cursor setup | Open repo, work under `site/`; optionally add a .cursor rule that limits edits to `site/`. |

For local preview: from repo root run `npm run dev`, then open **http://localhost:&lt;port&gt;/site**.
