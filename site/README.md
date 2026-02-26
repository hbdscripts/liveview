# Site (kexo.io/site)

New marketing/front-end site. Served at **https://kexo.io/site** (and **/site/**).

- **All changes for this project go in this folder only.** Do not edit files outside `site/`.
- The path is blocked in `robots.txt` while the site is in development (no indexing).
- See **docs/SITE_SETUP.md** for Git branch and Cursor workflow.

## Local preview

From repo root:

```bash
npm run dev
```

Then open **http://localhost:&lt;port&gt;/site**

## When the site is ready

Remove the `Disallow: /site` (and `/site/`) lines from **server/public/robots.txt** so the site can be indexed.
