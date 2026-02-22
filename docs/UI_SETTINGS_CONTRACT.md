# Settings/Admin UI contract (Kexo)

This document is the canonical contract for **all Settings and Admin panels** in Kexo.

If you touch Settings/Admin UI, you must follow this contract and keep it passing:

- `npm run ui:check`
- `npm test` (includes `tests/ui/settings-layout.spec.js`)

## Canonical structure

### Panel (Settings / Admin sub-panel)

- **Tabs / accordion headers are the section headers.**
- Panels must have **exactly one** `.settings-panel-wrap` as the **direct** child of the sub-panel root (created/enforced by the normaliser). **No nested layout:** do not inject another `.settings-panel-wrap` inside panels; templates and renderers must not add this wrapper.
- Default layout is single-column stacked (cards full-width).
- **Grids:** Use a **grid for 2+ repeated like-for-like items** (e.g. colors, icons, images, variant tiles). Use the class `.settings-responsive-grid`; do **not** use Bootstrap `.row`/`.col-*` or `.d-grid` for tile collections. Do not grid single, unique controls or mixed feature groupings—those stay stacked.

Example (sub-panel root IDs are important for the normaliser/tests):

```html
<div id="settings-integrations-panel-shopify">
  <div class="settings-panel-wrap">
    <div class="card card-sm">
      <div class="card-body">
        <!-- content -->
      </div>
    </div>
    <div class="card card-sm">
      <div class="card-header">
        <h4 class="card-title mb-0">Later headers are allowed</h4>
      </div>
      <div class="card-body">
        <!-- content -->
      </div>
    </div>
  </div>
</div>
```

### First-card header rule (absolute)

Inside every Settings/Admin sub-panel:

- **Only the first card’s header is removed**.
- **2nd/3rd/etc card headers must remain.**
- If the first header is **title-only**, the header is removed entirely.
- If the first header contains **controls/status/buttons**, those non-title controls must be preserved by moving them into the top of the card body inside `.settings-card-controls`, then remove the header container.

This is enforced at runtime by the Settings UI normaliser.

## Runtime guardrails

The Settings page includes a single normalisation pipeline that runs:

- on initial Settings init
- on sub-tab activations
- via a lightweight `MutationObserver` scoped to the Settings container (dynamic cards)

Files:

- `server/public/ui/settings-normaliser.js` (single source of truth)
- `server/public/settings-ui.css` (Settings-only styling)

## Forms, buttons, and actions

Use Tabler conventions:

- **Primary action** (Save/Apply/Update): `btn btn-primary btn-md`
- **Secondary**: `btn btn-secondary btn-md`
- **Danger**: `btn btn-danger btn-md`
- **Action row**: `d-flex align-items-center gap-2 flex-wrap` (buttons grouped, consistent spacing)
- **Form spacing**: prefer `mb-3` group spacing, `form-label`, `form-hint`

Avoid bespoke layout wrappers when Tabler provides a standard utility/class.

### Button variants (absolute)

- **Do not use any `btn-outline-*` classes** in Settings/Admin UI.
- Use solid variants instead (`btn-primary`, `btn-secondary`, `btn-danger`, etc.).

Migration mapping:

- `btn btn-outline-primary …` → `btn btn-primary …`
- `btn btn-outline-secondary …` → `btn btn-secondary …`
- `btn btn-outline-danger …` → `btn btn-danger …`
- `btn btn-outline-success …` → `btn btn-success …`

## Read-only / environment-backed fields

Fields that are environment-backed or otherwise not editable must **not** look editable:

- Prefer Tabler plaintext pattern for inputs: `form-control-plaintext`
- Use the existing **Read-only** label/badge + tooltip; do not add repetitive hint blocks.

## Loading / error / empty states

Do not show bare `—` placeholders in Settings/Admin panels without context.

Use consistent states:

- **Loading**: spinner + “Loading…”
- **Error**: “Failed to load” + Retry button (idempotent)
- **Empty**: “Not connected” / “No data” / “Not available”

## Do / Don’t

### Do

- Do have exactly one `.settings-panel-wrap` as the direct child of each sub-panel (normaliser enforces this).
- Do stack cards full-width when showing single or unique controls.
- Do use `.settings-responsive-grid` when showing **2+** repeated like-for-like items (colors, icons, images, variants, etc.).
- Do keep later card headers (Truth Sync / Pixel / Diagnostics, etc.).
- Do use Tabler button/form classes; prefer solid variants and use `btn-md`.
- Do make read-only fields clearly read-only with a hint (plaintext); avoid repetitive hint blocks.
- Do put all Settings-only CSS in `server/public/settings-ui.css` (no inline styles in templates/renderers).

### Don’t

- Don’t use nested `.settings-panel-wrap` or inject `.settings-panel-wrap` in renderers.
- Don’t use `btn-outline-*` button classes anywhere in Settings/Admin UI.
- Don’t use Bootstrap `.row`/`.d-grid` for tile grids; use `.settings-responsive-grid`.
- Don’t use grids for one-off controls or mixed content.
- Don’t add Settings-only CSS to global stylesheets (use `server/public/settings-ui.css` only).
- Don’t add inline styles in Settings templates/renderers.
- Don’t author a first card header in new Settings/Admin UI (tabs/accordion is the header).

