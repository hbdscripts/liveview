# Settings/Admin UI contract (Kexo)

This document is the canonical contract for **all Settings and Admin panels** in Kexo.

If you touch Settings/Admin UI, you must follow this contract and keep it passing:

- `npm run ui:check`
- `npm test` (includes `tests/ui/settings-layout.spec.js`)

## Canonical structure

### Panel (Settings / Admin sub-panel)

- **Tabs / accordion headers are the section headers.**
- Panels must have a single wrapper immediately under the sub-panel root: `.settings-panel-wrap`
- **No grids** in Settings/Admin panel content. All content is single-column stacked (cards full-width).

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

- **Primary action** (Save/Apply/Update): `btn btn-primary`
- **Secondary**: `btn btn-outline-secondary`
- **Danger**: `btn btn-danger` (or `btn btn-outline-danger` for soft actions)
- **Action row**: `d-flex align-items-center gap-2 flex-wrap` (buttons grouped, consistent spacing)
- **Form spacing**: prefer `mb-3` group spacing, `form-label`, `form-hint`

Avoid bespoke layout wrappers when Tabler provides a standard utility/class.

## Read-only / environment-backed fields

Fields that are environment-backed or otherwise not editable must **not** look editable:

- Prefer Tabler plaintext pattern for inputs: `form-control-plaintext`
- Add a consistent hint: `Read-only — set via environment config.`

## Loading / error / empty states

Do not show bare `—` placeholders in Settings/Admin panels without context.

Use consistent states:

- **Loading**: spinner + “Loading…”
- **Error**: “Failed to load” + Retry button (idempotent)
- **Empty**: “Not connected” / “No data” / “Not available”

## Do / Don’t

### Do

- Do wrap panel content in `.settings-panel-wrap`
- Do stack cards full-width
- Do keep later card headers (Truth Sync / Pixel / Diagnostics, etc.)
- Do use Tabler button/form classes
- Do make read-only fields clearly read-only with a hint

### Don’t

- Don’t introduce multi-column grids (`.row`, `.col-*`, `display: grid`) inside panel content
- Don’t add new Settings-only CSS to random global stylesheets (put it in `server/public/settings-ui.css`)
- Don’t add inline styles in Settings templates/renderers
- Don’t author a first card header in new Settings/Admin UI (tabs/accordion is the header)

