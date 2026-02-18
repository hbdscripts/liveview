# UI contract (Tabler-first)

Strict rules for UI in this repo. Follow them so new pages and features stay consistent.

---

## Markup and layout

- **Always use Tabler/Bootstrap** markup for page layout, cards, tables, forms, alerts, modals.
- **New pages** must start from the provided templates (see [server/public/partials/ui/](server/public/partials/ui/)).
- Do not invent random structures; use existing Tabler classes and patterns.

---

## Styles

- **No inline styles:** Do not use `style="..."` on any element.
- **No page-local `<style>` tags:** Do not add `<style>` blocks inside HTML pages.
- **All custom CSS** goes in the canonical CSS file(s) used by the app ([server/public/custom.css](server/public/custom.css), [server/public/tabler-theme.css](server/public/tabler-theme.css)).
- **Custom class prefix:** All app-specific classes must be prefixed with `kexo-` (e.g. `kexo-settings-accordion-chevron`, `kexo-overview-card`).

---

## Partials

- Use existing partials consistently: **head-theme**, **header**, **page-body-start**, **page-body-end**, **footer**.
- Include them in the same order on every full page (see [server/public/dashboard/overview.html](server/public/dashboard/overview.html) or [server/public/settings.html](server/public/settings.html) for reference).

---

## New components

- When a new component is needed: copy Tabler markup first, then add it to the **UI Kit** page ([server/public/ui-kit.html](server/public/ui-kit.html)) and to **server/public/partials/ui/** as a reference snippet.
- Do not ship one-off markup without adding it to the kit/snippets so future work stays consistent.

---

## Definition of Done (UI changes)

Before considering a UI change complete:

- [ ] Tabler/Bootstrap classes used; no custom layout that duplicates Tabler.
- [ ] No inline styles and no `<style>` in the page.
- [ ] Custom classes use the `kexo-` prefix and live in canonical CSS.
- [ ] Page uses standard partials (head-theme, header, page-body-start/end, footer) where applicable.
- [ ] New patterns added to UI Kit and/or partials/ui if they will be reused.

---

## Enforcement

- Run `npm run ui:check` before committing UI changes. It fails if `style="` or `<style` is found under server/public/** or client/app/** in HTML files.
