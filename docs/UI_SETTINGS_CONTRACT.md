# Settings/Admin UI contract (Kexo)

This document is the canonical contract for **all Settings and Admin panels** in Kexo.

If you touch Settings/Admin UI, you must follow this contract and keep it passing:

- `npm run ui:check`
- `npm test` (includes `tests/ui/settings-layout.spec.js`)

## Canonical structure

### Panel (Settings / Admin sub-panel)

- **Tabs / accordion headers are the section headers.** Use `<h4 class="accordion-header">` for accordion headers; do **not** use `<h2>` (to avoid document-outline pollution).
- **Icons:** Any icon used in Settings/Admin UI must include a `data-icon-key` attribute and have a corresponding mapping entry in `server/shared/icon-registry.js` (and be represented in the theme icon metadata/picker when user-configurable).
- Panels must have **exactly one** `.settings-panel-wrap` as the **direct** child of the sub-panel root (created/enforced by the normaliser). **No nested layout:** do not inject another `.settings-panel-wrap` inside panels; templates and renderers must not add this wrapper.
- Default layout is single-column stacked (cards full-width).
- **Grids:** Use `.settings-responsive-grid` for **tile-style repeated content**: 2+ like-for-like items (e.g. colour swatches, icon tiles, checkbox groups that are visually a set of options). Do **not** use Bootstrap `.row`/`.col-*` or `.d-grid` for those. Use `.row`/`.col-*` only for **form layout**: e.g. two unrelated fields side by side, or a small number of mixed controls in one row—not for repeated tiles. Do not grid single, unique controls or mixed feature groupings—those stay stacked.

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

## Save model and footer

- **Footer Save/Revert (draft):** Kexo (General, Assets, Icons, Colours, Layout & Styling), Layout (Tables, KPIs, Date ranges), Insights (Variants), Cost & profit. These tabs register in the draft registry; per-panel save buttons are hidden when the tab is active; the footer shows "Save Settings" / "Revert" when any registered section is dirty.
- **Immediate / inline save (no footer):** Attribution (Mapping rules, Channel tree). Changes save on action (e.g. "Save config", "Create mapping", modal "Save"). A short hint on the panel must explain that changes save immediately.
- **Read-only or per-action:** Integrations (Shopify display), Admin (Users, Diagnostics, Controls, Role permissions, Google Ads)—no global Save; each area has its own actions.

## Runtime guardrails

The Settings page includes a single normalisation pipeline that runs:

- on initial Settings init
- on sub-tab activations
- via a lightweight `MutationObserver` scoped to the Settings container (dynamic cards)

Files:

- `server/public/ui/settings-normaliser.js` (single source of truth)
- `server/public/settings-ui.css` (Settings-only styling)

### Mutation-loop prevention (required)

The normaliser’s `MutationObserver` reacts to DOM changes (e.g. `setHtml`/`setText` when data loads). If `normaliseSettingsPanel` **always** mutates the DOM (wrap, strip header, etc.), those mutations retrigger the observer → panel queued again → normalise again → **infinite loop** and visible flashing.

To prevent this:

- **`normaliseSettingsPanel` must return immediately** when the panel already has `data-settings-ui-normalised="1"`. The normaliser sets this attribute at the end of a full run; any observer-triggered re-run must no-op so no further mutations occur.
- Do **not** remove or bypass this “already normalised” check. The lint guardrail `npm run ui:check` enforces that the normaliser file contains this guard.

### Audit: coverage (zero flashing)

The fix is **live on every Settings/Admin panel** because:

1. **Single pipeline:** One `MutationObserver` observes the Settings container (`#settings-main-content` or `.col-lg-9` / `.page-body` / `body`). Any `childList` mutation (e.g. `innerHTML` / `setHtml`) that adds nodes causes the observer to find the closest panel via `SETTINGS_PANEL_SELECTOR` and queue it; the debounced flush calls `normaliseSettingsPanel(panel)` once per panel. The “already normalised” early return ensures the second and subsequent runs for that panel no-op, so no further DOM mutations and no loop.

2. **All panels use the same normaliser:** Every sub-panel root ID matches `SETTINGS_PANEL_SELECTOR` (`[id^="settings-"][id*="-panel-"]:not([id^="settings-panel-"]), [id^="admin-panel-"]`). Panels covered:

   - **Kexo:** `settings-kexo-panel-general`, `settings-kexo-panel-assets`, `settings-kexo-panel-icons`, `settings-kexo-panel-colours`, `settings-kexo-panel-layout-styling`
   - **Integrations:** `settings-integrations-panel-shopify`
   - **Layout:** `settings-layout-panel-tables`, `settings-layout-panel-kpis`, `settings-layout-panel-date-ranges`
   - **Attribution:** `settings-attribution-panel-mapping`, `settings-attribution-panel-tree`
   - **Insights:** `settings-insights-layout-panel-variants`
   - **Cost & profit:** `settings-cost-expenses-panel-cost-sources`, `settings-cost-expenses-panel-shipping`, `settings-cost-expenses-panel-rules`, `settings-cost-expenses-panel-breakdown`
   - **Admin:** `admin-panel-controls`, `admin-panel-diagnostics`, `admin-panel-users`, `admin-panel-role-permissions`, `admin-panel-googleads`

3. **No other loops:** The only `setInterval` on the Settings page is the Insights “Suggest mappings” elapsed timer (updates a single `textContent` every 500ms). The observer only reacts to **addedNodes**; it does not react to `textContent`/`characterData` changes. No other polling or repeated full-panel DOM replacement exists.

Conclusion: **Zero flashing** on every settings page, provided the “already normalised” guard remains in place and `ui:check` passes.

## Forms, buttons, and actions

Use Tabler conventions:

- **Primary action** (Save/Apply/Update): `btn btn-primary btn-md`
- **Secondary / default**: `btn btn-md` (do not use `btn-secondary`).
- **Danger**: `btn btn-danger btn-md`
- **Action row**: `d-flex align-items-center gap-2 flex-wrap` (buttons grouped, consistent spacing)
- **Form spacing**: prefer `mb-3` group spacing, `form-label`, `form-hint`

Avoid bespoke layout wrappers when Tabler provides a standard utility/class.

### Button variants (absolute)

- **Do not use any `btn-outline-*` classes** in Settings/Admin UI.
- Use solid variants instead (`btn-primary`, `btn-danger`, etc.). Do **not** use `btn-secondary`; use `btn btn-md` for secondary/default buttons.
- **Destructive actions** (Delete, Remove): use `btn btn-danger` (and `btn-sm` or `btn-md` as appropriate) in source. Do not rely on the normaliser to convert `btn-ghost-danger`; use solid danger in Settings/Admin source.
- **Primary save actions** (Save, Apply, Save config, Create mapping, etc.): use `btn btn-primary btn-md` in source.
- **Secondary/cancel:** use `btn btn-md` for secondary/default buttons. Source must use these classes so that the normaliser is not required to fix them.

Migration mapping:

- `btn btn-outline-primary …` → `btn btn-primary …`
- `btn btn-outline-secondary …` → `btn btn-md …`
- `btn btn-secondary …` → `btn btn-md …`
- `btn btn-outline-danger …` → `btn btn-danger …`
- `btn btn-outline-success …` → `btn btn-success …`
- `btn-ghost-danger` (destructive) → `btn btn-danger` + size

## Read-only / environment-backed fields

Fields that are environment-backed or otherwise not editable must **not** look editable:

- Prefer Tabler plaintext pattern for inputs: `form-control-plaintext`
- Use the existing **Read-only** label/badge + tooltip; do not add repetitive hint blocks.

## Loading / error / empty states

Do not show bare `—` placeholders in Settings/Admin panels without context.

Use consistent states:

- **Loading:** Use spinner + “Loading…”
- **Error:** Always show a clear message (e.g. "Failed to load") and an **idempotent Retry** button; do not leave a bare "—" or empty area.
- **Empty:** Use "No data", "Not connected", or "Not available" as appropriate; do not show bare "—" without context.

## Do / Don’t

### Do

- Do have exactly one `.settings-panel-wrap` as the direct child of each sub-panel (normaliser enforces this).
- Do stack cards full-width when showing single or unique controls.
- Do use `.settings-responsive-grid` when showing **2+** repeated like-for-like items (colors, icons, images, variants, etc.).
- Do keep later card headers (Truth Sync / Pixel / Diagnostics, etc.).
- Do use Tabler button/form classes; prefer solid variants and use `btn-md`.
- Do make read-only fields clearly read-only with a hint (plaintext); avoid repetitive hint blocks.
- Do put all Settings-only CSS in `server/public/settings-ui.css` (no inline styles in templates/renderers).
- Do use `<h4 class="accordion-header">` for accordion headers in Settings/Admin UI.
- Do use `data-icon-key` on icons and ensure each key is mapped in `server/shared/icon-registry.js`.

### Don’t

- Don’t use `<h2>` in Settings/Admin accordion headers.
- Don’t use nested `.settings-panel-wrap` or inject `.settings-panel-wrap` in renderers.
- Don’t remove or weaken the “already normalised” early return in `normaliseSettingsPanel` (see **Mutation-loop prevention** under Runtime guardrails); doing so reintroduces observer → normalise → mutate → observer loops and flashing.
- Don’t use `btn-outline-*` button classes anywhere in Settings/Admin UI.
- Don’t use Bootstrap `.row`/`.d-grid` for tile grids; use `.settings-responsive-grid`. (`.row` is allowed for form layout only.)
- Don’t use grids for one-off controls or mixed content.
- Don’t add Settings-only CSS to global stylesheets (use `server/public/settings-ui.css` only).
- Don’t add inline styles in Settings templates/renderers.
- Don’t author a first card header in new Settings/Admin UI (tabs/accordion is the header).

